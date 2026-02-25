/**
 * Staff API Routes — aligned with MongoDB Prisma schema
 */

import { Router, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/auth";
import { requireTeacher } from "../middleware/rbac";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation";

const router = Router();
router.use(authenticateJWT);

// ============================================
// ASSIGNMENTS
// ============================================

const createAssignmentSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  grade_level: z.string().min(1, "Grade level is required"),
  due_date: z.string().datetime("Invalid due date"),
});

const updateAssignmentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  grade_level: z.string().min(1).optional(),
  due_date: z.string().datetime().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

router.post(
  "/assignments",
  requireTeacher,
  validateBody(createAssignmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { user_id: req.user.id },
      });
      if (!staff) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a staff member" });
        return;
      }

      const { title, description, grade_level, due_date } = req.body;

      const assignment = await prisma.assignment.create({
        data: {
          title,
          description,
          grade_level,
          teacher_id: staff.id,
          due_date: new Date(due_date),
          status: "active",
        },
      });

      res.status(201).json({
        success: true,
        assignment: {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          grade_level: assignment.grade_level,
          due_date: assignment.due_date,
          status: assignment.status,
          created_at: assignment.created_at,
        },
      });
    } catch (error) {
      console.error("[Staff] Error creating assignment:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to create assignment",
      });
    }
  },
);

router.get(
  "/assignments",
  requireTeacher,
  validateQuery(
    z.object({
      grade_level: z.string().optional(),
      status: z.enum(["active", "archived"]).optional(),
      page: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 1)),
      limit: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 50)),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { user_id: req.user.id },
      });
      if (!staff) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a staff member" });
        return;
      }

      const query = req.query as unknown as {
        grade_level?: string;
        status?: string;
        page: number;
        limit: number;
      };
      const { grade_level, status, page = 1, limit = 50 } = query;
      const skip = (page - 1) * limit;

      const where: Prisma.AssignmentWhereInput = { teacher_id: staff.id };
      if (grade_level) where.grade_level = grade_level;
      if (status) where.status = status;

      const [assignments, total] = await Promise.all([
        prisma.assignment.findMany({
          where,
          skip,
          take: limit,
          orderBy: { due_date: "asc" },
        }),
        prisma.assignment.count({ where }),
      ]);

      res.json({
        success: true,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        assignments: assignments.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          grade_level: a.grade_level,
          due_date: a.due_date,
          status: a.status,
          created_at: a.created_at,
        })),
      });
    } catch (error) {
      console.error("[Staff] Error fetching assignments:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch assignments",
      });
    }
  },
);

router.put(
  "/assignments/:id",
  requireTeacher,
  validateParams(z.object({ id: z.string() })),
  validateBody(updateAssignmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { user_id: req.user.id },
      });
      if (!staff) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a staff member" });
        return;
      }

      const existing = await prisma.assignment.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res
          .status(404)
          .json({ error: "Not found", message: "Assignment not found" });
        return;
      }
      if (existing.teacher_id !== staff.id) {
        res.status(403).json({
          error: "Forbidden",
          message: "You can only update your own assignments",
        });
        return;
      }

      const updateData: Prisma.AssignmentUpdateInput = {};
      if (req.body.title) updateData.title = req.body.title;
      if (req.body.description !== undefined)
        updateData.description = req.body.description;
      if (req.body.grade_level) updateData.grade_level = req.body.grade_level;
      if (req.body.due_date) updateData.due_date = new Date(req.body.due_date);
      if (req.body.status) updateData.status = req.body.status;

      const assignment = await prisma.assignment.update({
        where: { id: req.params.id },
        data: updateData,
      });

      res.json({
        success: true,
        assignment: {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          grade_level: assignment.grade_level,
          due_date: assignment.due_date,
          status: assignment.status,
        },
      });
    } catch (error: any) {
      if (error.code === "P2025") {
        res
          .status(404)
          .json({ error: "Not found", message: "Assignment not found" });
      } else {
        console.error("[Staff] Error updating assignment:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to update assignment",
        });
      }
    }
  },
);

router.delete(
  "/assignments/:id",
  requireTeacher,
  validateParams(z.object({ id: z.string() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { user_id: req.user.id },
      });
      if (!staff) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a staff member" });
        return;
      }

      const existing = await prisma.assignment.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res
          .status(404)
          .json({ error: "Not found", message: "Assignment not found" });
        return;
      }
      if (existing.teacher_id !== staff.id) {
        res.status(403).json({
          error: "Forbidden",
          message: "You can only delete your own assignments",
        });
        return;
      }

      await prisma.assignment.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: "Assignment deleted successfully" });
    } catch (error: any) {
      if (error.code === "P2025") {
        res
          .status(404)
          .json({ error: "Not found", message: "Assignment not found" });
      } else {
        console.error("[Staff] Error deleting assignment:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to delete assignment",
        });
      }
    }
  },
);

// ============================================
// APPOINTMENTS
// ============================================

const createAppointmentSchema = z.object({
  parent_id: z.string(),
  scheduled_at: z.string().datetime("Invalid scheduled time"),
  parent_notes: z.string().optional(),
});

router.post(
  "/appointments",
  requireTeacher,
  validateBody(createAppointmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { user_id: req.user.id },
      });
      if (!staff) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a staff member" });
        return;
      }

      const { parent_id, scheduled_at, parent_notes } = req.body;

      const parent = await prisma.parent.findUnique({
        where: { id: parent_id },
      });
      if (!parent) {
        res
          .status(404)
          .json({ error: "Not found", message: "Parent not found" });
        return;
      }

      const appointment = await prisma.appointment.create({
        data: {
          teacher_id: staff.id,
          parent_id,
          scheduled_at: new Date(scheduled_at),
          parent_notes,
          status: "pending",
        },
        include: {
          parent: {
            select: { full_name: true, phone_number: true, email: true },
          },
        },
      });

      res.status(201).json({
        success: true,
        appointment: {
          id: appointment.id,
          parent_name: appointment.parent?.full_name,
          parent_phone: appointment.parent?.phone_number,
          scheduled_at: appointment.scheduled_at,
          status: appointment.status,
          parent_notes: appointment.parent_notes,
          created_at: appointment.created_at,
        },
      });
    } catch (error) {
      console.error("[Staff] Error creating appointment:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to create appointment",
      });
    }
  },
);

router.get(
  "/appointments",
  requireTeacher,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { user_id: req.user.id },
      });
      if (!staff) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a staff member" });
        return;
      }

      const appointments = await prisma.appointment.findMany({
        where: { teacher_id: staff.id },
        include: {
          parent: {
            select: { full_name: true, phone_number: true, email: true },
          },
        },
        orderBy: { scheduled_at: "asc" },
      });

      res.json({
        success: true,
        count: appointments.length,
        appointments: appointments.map((a) => ({
          id: a.id,
          parent_name: a.parent?.full_name,
          parent_phone: a.parent?.phone_number,
          scheduled_at: a.scheduled_at,
          status: a.status,
          parent_notes: a.parent_notes,
          created_at: a.created_at,
        })),
      });
    } catch (error) {
      console.error("[Staff] Error fetching appointments:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch appointments",
      });
    }
  },
);

router.put(
  "/appointments/:id/status",
  requireTeacher,
  validateParams(z.object({ id: z.string() })),
  validateBody(
    z.object({ status: z.enum(["pending", "confirmed", "cancelled"]) }),
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { user_id: req.user.id },
      });
      if (!staff) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a staff member" });
        return;
      }

      const existing = await prisma.appointment.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res
          .status(404)
          .json({ error: "Not found", message: "Appointment not found" });
        return;
      }
      if (existing.teacher_id !== staff.id) {
        res.status(403).json({
          error: "Forbidden",
          message: "You can only update your own appointments",
        });
        return;
      }

      const appointment = await prisma.appointment.update({
        where: { id: req.params.id },
        data: { status: req.body.status },
      });

      res.json({
        success: true,
        appointment: { id: appointment.id, status: appointment.status },
      });
    } catch (error: any) {
      if (error.code === "P2025") {
        res
          .status(404)
          .json({ error: "Not found", message: "Appointment not found" });
      } else {
        console.error("[Staff] Error updating appointment status:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to update appointment",
        });
      }
    }
  },
);

// ============================================
// STUDENTS (read-only)
// ============================================

router.get(
  "/students",
  requireTeacher,
  validateQuery(
    z.object({
      grade_level: z.string().optional(),
      search: z.string().optional(),
      page: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 1)),
      limit: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 50)),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = req.query as unknown as {
        grade_level?: string;
        search?: string;
        page: number;
        limit: number;
      };
      const { grade_level, search, page = 1, limit = 50 } = query;
      const skip = (page - 1) * limit;

      const where: Prisma.StudentWhereInput = {};
      if (grade_level) where.grade_level = grade_level;
      if (search) {
        where.OR = [
          { admission_number: { contains: search } },
          { full_name: { contains: search } },
        ];
      }

      const [students, total] = await Promise.all([
        prisma.student.findMany({
          where,
          skip,
          take: limit,
          select: {
            id: true,
            admission_number: true,
            full_name: true,
            grade_level: true,
            wallet_balance: true,
            created_at: true,
          },
        }),
        prisma.student.count({ where }),
      ]);

      res.json({
        success: true,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        students: students.map((s) => ({
          id: s.id,
          admission_number: s.admission_number,
          full_name: s.full_name,
          grade_level: s.grade_level,
          wallet_balance: Number(s.wallet_balance ?? 0),
          created_at: s.created_at,
        })),
      });
    } catch (error) {
      console.error("[Staff] Error fetching students:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch students",
      });
    }
  },
);

// ============================================
// ATTENDANCE (read-only)
// ============================================

router.get(
  "/attendance",
  requireTeacher,
  validateQuery(
    z.object({
      studentId: z.string().optional(),
      grade_level: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      page: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 1)),
      limit: z
        .string()
        .regex(/^\d+$/)
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 50)),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = req.query as unknown as {
        studentId?: string;
        grade_level?: string;
        startDate?: string;
        endDate?: string;
        page: number;
        limit: number;
      };
      const {
        studentId,
        grade_level,
        startDate,
        endDate,
        page = 1,
        limit = 50,
      } = query;
      const skip = (page - 1) * limit;

      const where: Prisma.AttendanceWhereInput = {};
      if (studentId) where.student_id = studentId;

      if (grade_level && !studentId) {
        const students = await prisma.student.findMany({
          where: { grade_level },
          select: { id: true },
        });
        where.student_id = { in: students.map((s) => s.id) };
      }

      if (startDate || endDate) {
        where.created_at = {};
        if (startDate) {
          const s = new Date(startDate);
          s.setHours(0, 0, 0, 0);
          (where.created_at as any).gte = s;
        }
        if (endDate) {
          const e = new Date(endDate);
          e.setHours(23, 59, 59, 999);
          (where.created_at as any).lte = e;
        }
      }

      const [attendance, total] = await Promise.all([
        prisma.attendance.findMany({
          where,
          skip,
          take: limit,
          orderBy: { created_at: "desc" },
          include: {
            student: {
              select: {
                id: true,
                admission_number: true,
                full_name: true,
                grade_level: true,
              },
            },
          },
        }),
        prisma.attendance.count({ where }),
      ]);

      res.json({
        success: true,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        attendance: attendance.map((a) => ({
          id: a.id,
          student_id: a.student_id,
          admission_number: a.student?.admission_number,
          full_name: a.student?.full_name,
          grade_level: a.student?.grade_level,
          check_type: a.check_type,
          device_id: a.device_id,
          timestamp: a.created_at,
        })),
      });
    } catch (error) {
      console.error("[Staff] Error fetching attendance:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch attendance",
      });
    }
  },
);

export default router;
