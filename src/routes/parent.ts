/**
 * Parent API Routes — aligned with MongoDB Prisma schema
 */

import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../config/database";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/auth";
import { verifyParentOwnership } from "../middleware/rbac";
import { validateParams, validateQuery } from "../middleware/validation";

const router = Router();
router.use(authenticateJWT);

/**
 * GET /parent/students
 */
router.get("/students", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parent = await prisma.parent.findFirst({
      where: { user_id: req.user.id },
    });
    if (!parent) {
      res
        .status(403)
        .json({ error: "Forbidden", message: "User is not a parent" });
      return;
    }

    const parentStudentMaps = await prisma.parentStudentMap.findMany({
      where: { parent_id: parent.id },
      include: {
        student: {
          select: {
            id: true,
            admission_number: true,
            full_name: true,
            grade_level: true,
            card_uid: true,
            wallet_balance: true,
            created_at: true,
          },
        },
      },
    });

    res.json({
      success: true,
      count: parentStudentMaps.length,
      students: parentStudentMaps.map((psm) => ({
        id: psm.student.id,
        admission_number: psm.student.admission_number,
        full_name: psm.student.full_name,
        grade_level: psm.student.grade_level,
        card_uid: psm.student.card_uid,
        wallet_balance: Number(psm.student.wallet_balance ?? 0),
        relationship: psm.relationship,
        created_at: psm.student.created_at,
      })),
    });
  } catch (error) {
    console.error("[Parent] Error fetching students:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to fetch students",
    });
  }
});

/**
 * GET /parent/attendance/:studentId
 */
const studentParamSchema = z.object({ studentId: z.string() });

const attendanceQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 100)),
});

router.get(
  "/attendance/:studentId",
  validateParams(studentParamSchema),
  validateQuery(attendanceQuerySchema),
  verifyParentOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { studentId } = req.params;
      const {
        startDate,
        endDate,
        limit = 100,
      } = req.query as unknown as {
        startDate?: string;
        endDate?: string;
        limit: number;
      };

      let dateFilter: { gte?: Date; lte?: Date } = {};

      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        dateFilter.gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        dateFilter.lte = e;
      }

      if (!startDate && !endDate) {
        const e = new Date();
        e.setHours(23, 59, 59, 999);
        const s = new Date(e);
        s.setDate(s.getDate() - 30);
        s.setHours(0, 0, 0, 0);
        dateFilter = { gte: s, lte: e };
      }

      const attendance = await prisma.attendance.findMany({
        where: {
          student_id: studentId,
          ...(Object.keys(dateFilter).length > 0
            ? { created_at: dateFilter }
            : {}),
        },
        orderBy: { created_at: "desc" },
        take: limit,
      });

      res.json({
        success: true,
        student_id: studentId,
        count: attendance.length,
        attendance: attendance.map((a) => ({
          id: a.id,
          check_type: a.check_type,
          device_id: a.device_id,
          timestamp: a.created_at,
        })),
      });
    } catch (error) {
      console.error("[Parent] Error fetching attendance:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch attendance",
      });
    }
  },
);

/**
 * GET /parent/financial/:studentId
 */
router.get(
  "/financial/:studentId",
  validateParams(studentParamSchema),
  verifyParentOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { studentId } = req.params;

      const [student, recentTransactions] = await Promise.all([
        prisma.student.findUnique({
          where: { id: studentId },
          select: {
            id: true,
            admission_number: true,
            full_name: true,
            wallet_balance: true,
          },
        }),
        prisma.feeTransaction.findMany({
          where: { student_id: studentId },
          orderBy: { created_at: "desc" },
          take: 20,
        }),
      ]);

      if (!student) {
        res
          .status(404)
          .json({ error: "Not found", message: "Student not found" });
        return;
      }

      res.json({
        success: true,
        student: {
          id: student.id,
          admission_number: student.admission_number,
          full_name: student.full_name,
          wallet_balance: Number(student.wallet_balance ?? 0),
        },
        recent_transactions: recentTransactions.map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          description: t.description,
          created_at: t.created_at,
        })),
      });
    } catch (error) {
      console.error("[Parent] Error fetching financial data:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch financial data",
      });
    }
  },
);

/**
 * GET /parent/assignments/:studentId
 */
router.get(
  "/assignments/:studentId",
  validateParams(studentParamSchema),
  verifyParentOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { studentId } = req.params;

      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { grade_level: true, admission_number: true },
      });

      if (!student) {
        res
          .status(404)
          .json({ error: "Not found", message: "Student not found" });
        return;
      }

      const assignments = await prisma.assignment.findMany({
        where: { grade_level: student.grade_level, status: "active" },
        include: {
          teacher: {
            select: { id: true, full_name: true, subject_specialty: true },
          },
        },
        orderBy: { due_date: "asc" },
      });

      res.json({
        success: true,
        student_id: studentId,
        grade_level: student.grade_level,
        count: assignments.length,
        assignments: assignments.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          grade_level: a.grade_level,
          due_date: a.due_date,
          status: a.status,
          teacher_name: a.teacher?.full_name,
          teacher_subject: a.teacher?.subject_specialty,
          created_at: a.created_at,
        })),
      });
    } catch (error) {
      console.error("[Parent] Error fetching assignments:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch assignments",
      });
    }
  },
);

/**
 * GET /parent/appointments
 */
router.get(
  "/appointments",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const parent = await prisma.parent.findFirst({
        where: { user_id: req.user.id },
      });
      if (!parent) {
        res
          .status(403)
          .json({ error: "Forbidden", message: "User is not a parent" });
        return;
      }

      const appointments = await prisma.appointment.findMany({
        where: { parent_id: parent.id },
        include: {
          teacher: {
            select: { id: true, full_name: true, subject_specialty: true },
          },
        },
        orderBy: { scheduled_at: "asc" },
      });

      res.json({
        success: true,
        count: appointments.length,
        appointments: appointments.map((a) => ({
          id: a.id,
          teacher_name: a.teacher?.full_name,
          teacher_subject: a.teacher?.subject_specialty,
          scheduled_at: a.scheduled_at,
          status: a.status,
          parent_notes: a.parent_notes,
          created_at: a.created_at,
        })),
      });
    } catch (error) {
      console.error("[Parent] Error fetching appointments:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch appointments",
      });
    }
  },
);

export default router;
