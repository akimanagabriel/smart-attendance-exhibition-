/**
 * Admin API Routes — aligned with MongoDB schema
 */

import { Router, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/auth";
import { requireAdmin } from "../middleware/rbac";
import {
  validateQuery,
  validateBody,
  validateParams,
} from "../middleware/validation";

const router = Router();

router.use(authenticateJWT);
router.use(requireAdmin);

// ============================================
// LIVE DASHBOARD
// ============================================

router.get(
  "/attendance/live",
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const checkIns = await prisma.attendance.findMany({
        where: { check_type: "IN", created_at: { gte: today, lt: tomorrow } },
        include: {
          student: {
            select: { id: true, admission_number: true, full_name: true },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const checkOuts = await prisma.attendance.findMany({
        where: { check_type: "OUT", created_at: { gte: today, lt: tomorrow } },
        select: { student_id: true },
      });

      const checkedOutIds = new Set(checkOuts.map((a) => a.student_id));
      const inSchool = checkIns.filter((a) => !checkedOutIds.has(a.student_id));

      res.json({
        success: true,
        count: inSchool.length,
        students: inSchool.map((a) => ({
          student_id: a.student?.id,
          admission_number: a.student?.admission_number,
          full_name: a.student?.full_name,
          check_in_time: a.created_at,
          device_id: a.device_id,
        })),
      });
    } catch (error) {
      console.error("[Admin] Error fetching live attendance:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch live attendance",
      });
    }
  },
);

// ============================================
// LATENESS
// ============================================

const latenessQuerySchema = z.object({
  date: z.string().optional(),
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
});

router.get(
  "/lateness",
  validateQuery(latenessQuerySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        date,
        page = 1,
        limit = 50,
      } = req.query as unknown as z.infer<typeof latenessQuerySchema>;
      const targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const lateThreshold = new Date(targetDate);
      lateThreshold.setHours(8, 0, 0, 0);

      const skip = (page - 1) * limit;

      const [lateAttendance, total] = await Promise.all([
        prisma.attendance.findMany({
          where: {
            check_type: "IN",
            created_at: { gte: lateThreshold, lt: nextDay },
          },
          include: {
            student: {
              select: { id: true, admission_number: true, full_name: true },
            },
          },
          orderBy: { created_at: "desc" },
          skip,
          take: limit,
        }),
        prisma.attendance.count({
          where: {
            check_type: "IN",
            created_at: { gte: lateThreshold, lt: nextDay },
          },
        }),
      ]);

      res.json({
        success: true,
        date: targetDate.toISOString().split("T")[0],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        late_students: lateAttendance.map((a) => ({
          student_id: a.student?.id,
          admission_number: a.student?.admission_number,
          full_name: a.student?.full_name,
          check_in_time: a.created_at,
          device_id: a.device_id,
        })),
      });
    } catch (error) {
      console.error("[Admin] Error fetching lateness data:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch lateness data",
      });
    }
  },
);

// ============================================
// FEES TODAY
// ============================================

router.get("/fees/today", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [transactions, summary] = await Promise.all([
      prisma.feeTransaction.findMany({
        where: { created_at: { gte: today, lt: tomorrow } },
        include: {
          student: {
            select: { id: true, admission_number: true, full_name: true },
          },
        },
        orderBy: { created_at: "desc" },
      }),
      prisma.feeTransaction.groupBy({
        by: ["type"],
        where: { created_at: { gte: today, lt: tomorrow } },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const credits =
      summary.find((s) => s.type?.toUpperCase() === "CREDIT")?._sum?.amount ??
      0;
    const debits =
      summary.find((s) => s.type?.toUpperCase() === "DEBIT")?._sum?.amount ?? 0;

    res.json({
      success: true,
      date: today.toISOString().split("T")[0],
      summary: {
        total_credits: Number(credits),
        total_debits: Number(debits),
        net_amount: Number(credits) - Number(debits),
        transaction_count: transactions.length,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        student_id: t.student?.id,
        admission_number: t.student?.admission_number,
        full_name: t.student?.full_name,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        created_at: t.created_at,
      })),
    });
  } catch (error) {
    console.error("[Admin] Error fetching fees data:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to fetch fees data",
    });
  }
});

// ============================================
// STUDENTS IN SCHOOL
// ============================================

router.get(
  "/students/in-school",
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const checkIns = await prisma.attendance.findMany({
        where: { check_type: "IN", created_at: { gte: today, lt: tomorrow } },
        include: {
          student: {
            select: {
              id: true,
              admission_number: true,
              full_name: true,
              card_uid: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const checkOuts = await prisma.attendance.findMany({
        where: { check_type: "OUT", created_at: { gte: today, lt: tomorrow } },
        select: { student_id: true, created_at: true },
        orderBy: { created_at: "desc" },
      });

      const studentStatus = new Map<
        string,
        { checkIn: Date; checkOut?: Date }
      >();

      checkIns.forEach((c) => {
        const existing = studentStatus.get(c.student_id!);
        if (!existing || c.created_at! > existing.checkIn) {
          studentStatus.set(c.student_id!, { checkIn: c.created_at! });
        }
      });

      checkOuts.forEach((c) => {
        const existing = studentStatus.get(c.student_id!);
        if (
          existing &&
          (!existing.checkOut || c.created_at! > existing.checkOut)
        ) {
          existing.checkOut = c.created_at!;
        }
      });

      const inSchool = Array.from(studentStatus.entries())
        .filter(([_, s]) => !s.checkOut)
        .map(([studentId, s]) => {
          const ci = checkIns.find(
            (c) =>
              c.student_id === studentId &&
              c.created_at?.getTime() === s.checkIn.getTime(),
          );
          return {
            student_id: studentId,
            admission_number: ci?.student?.admission_number,
            full_name: ci?.student?.full_name,
            card_uid: ci?.student?.card_uid,
            check_in_time: s.checkIn,
          };
        });

      res.json({ success: true, count: inSchool.length, students: inSchool });
    } catch (error) {
      console.error("[Admin] Error fetching in-school students:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch in-school students",
      });
    }
  },
);

// ============================================
// STUDENTS CRUD
// ============================================

const createStudentSchema = z.object({
  admission_number: z.string().min(1),
  full_name: z.string().min(1),
  grade_level: z.string().min(1),
  card_uid: z.string().min(1).optional(),
  wallet_balance: z.number().min(0).optional().default(0),
});

const updateStudentSchema = z.object({
  admission_number: z.string().min(1).optional(),
  full_name: z.string().min(1).optional(),
  grade_level: z.string().min(1).optional(),
  card_uid: z.string().min(1).optional(),
  wallet_balance: z.number().min(0).optional(),
});

router.post(
  "/students",
  validateBody(createStudentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const student = await prisma.student.create({
        data: {
          admission_number: req.body.admission_number,
          full_name: req.body.full_name,
          grade_level: req.body.grade_level,
          card_uid: req.body.card_uid,
          wallet_balance: req.body.wallet_balance ?? 0,
        },
      });

      res.status(201).json({
        success: true,
        student: {
          id: student.id,
          admission_number: student.admission_number,
          full_name: student.full_name,
          grade_level: student.grade_level,
          card_uid: student.card_uid,
          wallet_balance: Number(student.wallet_balance),
        },
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        res.status(409).json({
          error: "Conflict",
          message:
            "Student with this admission number or card UID already exists",
        });
      } else {
        console.error("[Admin] Error creating student:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to create student",
        });
      }
    }
  },
);

router.get(
  "/students",
  validateQuery(
    z.object({
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
      search: z.string().optional(),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { page = 1, limit = 50, search } = req.query as any;
      const skip = (page - 1) * limit;

      const where: Prisma.StudentWhereInput = {};
      if (search) {
        where.OR = [
          { admission_number: { contains: search } },
          { full_name: { contains: search } },
          { card_uid: { contains: search } },
        ];
      }

      const [students, total] = await Promise.all([
        prisma.student.findMany({
          where,
          skip,
          take: limit,
          orderBy: { created_at: "desc" },
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
          card_uid: s.card_uid,
          wallet_balance: Number(s.wallet_balance),
          created_at: s.created_at,
        })),
      });
    } catch (error) {
      console.error("[Admin] Error fetching students:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch students",
      });
    }
  },
);

router.get(
  "/students/:id",
  validateParams(z.object({ id: z.string() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const student = await prisma.student.findUnique({
        where: { id: req.params.id },
        include: {
          parentStudentMaps: {
            include: {
              parent: {
                select: {
                  id: true,
                  full_name: true,
                  phone_number: true,
                  email: true,
                },
              },
            },
          },
        },
      });

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
          grade_level: student.grade_level,
          card_uid: student.card_uid,
          wallet_balance: Number(student.wallet_balance),
          parents: student.parentStudentMaps.map((psm) => ({
            parent_id: psm.parent.id,
            full_name: psm.parent.full_name,
            phone_number: psm.parent.phone_number,
            email: psm.parent.email,
            relationship: psm.relationship,
          })),
          created_at: student.created_at,
        },
      });
    } catch (error) {
      console.error("[Admin] Error fetching student:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch student",
      });
    }
  },
);

router.put(
  "/students/:id",
  validateParams(z.object({ id: z.string() })),
  validateBody(updateStudentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updateData: Prisma.StudentUpdateInput = {};
      if (req.body.admission_number)
        updateData.admission_number = req.body.admission_number;
      if (req.body.full_name) updateData.full_name = req.body.full_name;
      if (req.body.grade_level) updateData.grade_level = req.body.grade_level;
      if (req.body.card_uid) updateData.card_uid = req.body.card_uid;
      if (req.body.wallet_balance !== undefined)
        updateData.wallet_balance = req.body.wallet_balance;

      const student = await prisma.student.update({
        where: { id: req.params.id },
        data: updateData,
      });

      res.json({
        success: true,
        student: {
          id: student.id,
          admission_number: student.admission_number,
          full_name: student.full_name,
          grade_level: student.grade_level,
          card_uid: student.card_uid,
          wallet_balance: Number(student.wallet_balance),
        },
      });
    } catch (error: any) {
      if (error.code === "P2025") {
        res
          .status(404)
          .json({ error: "Not found", message: "Student not found" });
      } else if (error.code === "P2002") {
        res.status(409).json({
          error: "Conflict",
          message: "Duplicate admission number or card UID",
        });
      } else {
        console.error("[Admin] Error updating student:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to update student",
        });
      }
    }
  },
);

router.delete(
  "/students/:id",
  validateParams(z.object({ id: z.string() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.student.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: "Student deleted successfully" });
    } catch (error: any) {
      if (error.code === "P2025") {
        res
          .status(404)
          .json({ error: "Not found", message: "Student not found" });
      } else {
        console.error("[Admin] Error deleting student:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to delete student",
        });
      }
    }
  },
);

// ============================================
// STAFF CRUD
// ============================================

const createStaffSchema = z.object({
  user_id: z.string(),
  full_name: z.string().min(1),
  role: z.enum(["admin", "teacher", "accountant"]).default("teacher"),
  subject_specialty: z.string().optional(),
});

const updateStaffSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(["admin", "teacher", "accountant"]).optional(),
  subject_specialty: z.string().optional(),
});

router.post(
  "/staff",
  validateBody(createStaffSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const staff = await prisma.staff.create({
        data: {
          user_id: req.body.user_id,
          full_name: req.body.full_name,
          role: req.body.role,
          subject_specialty: req.body.subject_specialty,
        },
      });
      res.status(201).json({
        success: true,
        staff: { id: staff.id, full_name: staff.full_name, role: staff.role },
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        res.status(409).json({
          error: "Conflict",
          message: "Staff with this user_id already exists",
        });
      } else {
        console.error("[Admin] Error creating staff:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to create staff",
        });
      }
    }
  },
);

router.get("/staff", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = await prisma.staff.findMany({
      orderBy: { created_at: "desc" },
    });
    res.json({
      success: true,
      count: staff.length,
      staff: staff.map((s) => ({
        id: s.id,
        full_name: s.full_name,
        role: s.role,
        subject_specialty: s.subject_specialty,
        created_at: s.created_at,
      })),
    });
  } catch (error) {
    console.error("[Admin] Error fetching staff:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to fetch staff",
    });
  }
});

router.put(
  "/staff/:id",
  validateParams(z.object({ id: z.string() })),
  validateBody(updateStaffSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const staff = await prisma.staff.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.full_name && { full_name: req.body.full_name }),
          ...(req.body.role && { role: req.body.role }),
          ...(req.body.subject_specialty !== undefined && {
            subject_specialty: req.body.subject_specialty,
          }),
        },
      });
      res.json({
        success: true,
        staff: { id: staff.id, full_name: staff.full_name, role: staff.role },
      });
    } catch (error: any) {
      if (error.code === "P2025") {
        res
          .status(404)
          .json({ error: "Not found", message: "Staff member not found" });
      } else {
        console.error("[Admin] Error updating staff:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to update staff",
        });
      }
    }
  },
);

router.delete(
  "/staff/:id",
  validateParams(z.object({ id: z.string() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.staff.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: "Staff deleted successfully" });
    } catch (error: any) {
      if (error.code === "P2025") {
        res
          .status(404)
          .json({ error: "Not found", message: "Staff member not found" });
      } else {
        console.error("[Admin] Error deleting staff:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to delete staff",
        });
      }
    }
  },
);

// ============================================
// PARENTS CRUD
// ============================================

const createParentSchema = z.object({
  user_id: z.string(),
  full_name: z.string().min(1),
  phone_number: z.string().optional(),
  email: z.string().email().optional(),
});

router.post(
  "/parents",
  validateBody(createParentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parent = await prisma.parent.create({
        data: {
          user_id: req.body.user_id,
          full_name: req.body.full_name,
          phone_number: req.body.phone_number,
          email: req.body.email,
        },
      });
      res.status(201).json({
        success: true,
        parent: {
          id: parent.id,
          full_name: parent.full_name,
          email: parent.email,
        },
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        res.status(409).json({
          error: "Conflict",
          message: "Parent already exists with this user_id, email, or phone",
        });
      } else {
        console.error("[Admin] Error creating parent:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to create parent",
        });
      }
    }
  },
);

router.get("/parents", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const parents = await prisma.parent.findMany({
      orderBy: { created_at: "desc" },
    });
    res.json({
      success: true,
      count: parents.length,
      parents: parents.map((p) => ({
        id: p.id,
        full_name: p.full_name,
        phone_number: p.phone_number,
        email: p.email,
        created_at: p.created_at,
      })),
    });
  } catch (error) {
    console.error("[Admin] Error fetching parents:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to fetch parents",
    });
  }
});

// ============================================
// PARENT-STUDENT LINKING
// ============================================

router.post(
  "/parents/:parentId/students/:studentId",
  validateParams(z.object({ parentId: z.string(), studentId: z.string() })),
  validateBody(z.object({ relationship: z.string().optional() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const link = await prisma.parentStudentMap.create({
        data: {
          parent_id: req.params.parentId,
          student_id: req.params.studentId,
          relationship: req.body.relationship,
        },
      });
      res.status(201).json({ success: true, link });
    } catch (error: any) {
      if (error.code === "P2002") {
        res.status(409).json({
          error: "Conflict",
          message: "Parent is already linked to this student",
        });
      } else {
        console.error("[Admin] Error linking parent to student:", error);
        res.status(500).json({
          error: "Internal server error",
          message: "Failed to link parent to student",
        });
      }
    }
  },
);

// ============================================
// FEE TRANSACTIONS
// ============================================

router.post(
  "/fees/credit",
  validateBody(
    z.object({
      student_id: z.string(),
      amount: z.number().positive(),
      description: z.string().optional(),
    }),
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { student_id, amount, description } = req.body;

      const student = await prisma.student.findUnique({
        where: { id: student_id },
      });
      if (!student) {
        res
          .status(404)
          .json({ error: "Not found", message: "Student not found" });
        return;
      }

      const newBalance = (student.wallet_balance ?? 0) + amount;

      await prisma.student.update({
        where: { id: student_id },
        data: { wallet_balance: newBalance },
      });

      const txRecord = await prisma.feeTransaction.create({
        data: { student_id, amount, type: "CREDIT", description },
      });

      res.status(201).json({
        success: true,
        new_balance: newBalance,
        transaction_id: txRecord.id,
      });
    } catch (error: any) {
      console.error("[Admin] Error crediting wallet:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to credit wallet",
      });
    }
  },
);

// ============================================
// ATTENDANCE RECORDS
// ============================================

router.get(
  "/attendance",
  validateQuery(
    z.object({
      studentId: z.string().optional(),
      date: z.string().optional(),
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
      const {
        studentId,
        date,
        page = 1,
        limit = 50,
      } = req.query as unknown as {
        studentId?: string;
        date?: string;
        page: number;
        limit: number;
      };
      const skip = (page - 1) * limit;

      const where: Prisma.AttendanceWhereInput = {};
      if (studentId) where.student_id = studentId;
      if (date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const nd = new Date(d);
        nd.setDate(nd.getDate() + 1);
        where.created_at = { gte: d, lt: nd };
      }

      const [records, total] = await Promise.all([
        prisma.attendance.findMany({
          where,
          skip,
          take: limit,
          orderBy: { created_at: "desc" },
          include: {
            student: { select: { admission_number: true, full_name: true } },
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
        attendance: records.map((a) => ({
          id: a.id,
          student_id: a.student_id,
          admission_number: a.student?.admission_number,
          full_name: a.student?.full_name,
          check_type: a.check_type,
          device_id: a.device_id,
          timestamp: a.created_at,
        })),
      });
    } catch (error) {
      console.error("[Admin] Error fetching attendance:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to fetch attendance",
      });
    }
  },
);

export default router;
