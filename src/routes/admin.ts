/**
 * Admin API Routes — aligned with actual Supabase DB schema
 *
 * DB fields used:
 *  Student:       id, admissionNumber, full_name, grade_level, cardUid, walletBalance, createdAt
 *  Parent:        id, userId, full_name, phone_number, email, createdAt
 *  Staff:         id, userId, full_name, subject_specialty, role, createdAt
 *  Attendance:    id, studentId, checkType (String), deviceId (String), createdAt
 *  FeeTransaction:id, studentId, amount, type (String), description, createdAt
 *  Assignment:    id, teacherId, title, description, grade_level, dueDate, status, createdAt
 *  Appointment:   id, parentId, teacherId, scheduledAt, status, parent_notes, createdAt
 *  ParentStudentMap: [parentId, studentId], relationship
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { validateQuery, validateBody, validateParams } from '../middleware/validation';

const router = Router();

router.use(authenticateJWT);
router.use(requireAdmin);

// ============================================
// LIVE DASHBOARD
// ============================================

/**
 * GET /admin/attendance/live
 * Students who checked IN today and have not checked OUT
 */
router.get('/attendance/live', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const checkIns = await prisma.attendance.findMany({
      where: { checkType: 'IN', createdAt: { gte: today, lt: tomorrow } },
      include: { student: { select: { id: true, admissionNumber: true, full_name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const checkOuts = await prisma.attendance.findMany({
      where: { checkType: 'OUT', createdAt: { gte: today, lt: tomorrow } },
      select: { studentId: true },
    });

    const checkedOutIds = new Set(checkOuts.map(a => a.studentId));
    const inSchool = checkIns.filter(a => !checkedOutIds.has(a.studentId));

    res.json({
      success: true,
      count: inSchool.length,
      students: inSchool.map(a => ({
        student_id: a.student?.id,
        admission_number: a.student?.admissionNumber,
        full_name: a.student?.full_name,
        check_in_time: a.createdAt,
        device_id: a.deviceId,
      })),
    });
  } catch (error) {
    console.error('[Admin] Error fetching live attendance:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch live attendance' });
  }
});

/**
 * GET /admin/lateness
 * Students who checked IN today after 08:00
 */
const latenessQuerySchema = z.object({
  date: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 1),
  limit: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 50),
});

router.get('/lateness', validateQuery(latenessQuerySchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, page = 1, limit = 50 } = req.query as unknown as z.infer<typeof latenessQuerySchema>;
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // "Late" = checked IN after 08:00 — we check createdAt hour
    const lateThreshold = new Date(targetDate);
    lateThreshold.setHours(8, 0, 0, 0);

    const skip = (page - 1) * limit;

    const [lateAttendance, total] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          checkType: 'IN',
          createdAt: { gte: lateThreshold, lt: nextDay },
        },
        include: {
          student: { select: { id: true, admissionNumber: true, full_name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.attendance.count({
        where: {
          checkType: 'IN',
          createdAt: { gte: lateThreshold, lt: nextDay },
        },
      }),
    ]);

    res.json({
      success: true,
      date: targetDate.toISOString().split('T')[0],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      late_students: lateAttendance.map(a => ({
        student_id: a.student?.id,
        admission_number: a.student?.admissionNumber,
        full_name: a.student?.full_name,
        check_in_time: a.createdAt,
        device_id: a.deviceId,
      })),
    });
  } catch (error) {
    console.error('[Admin] Error fetching lateness data:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch lateness data' });
  }
});

/**
 * GET /admin/fees/today
 */
router.get('/fees/today', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [transactions, summary] = await Promise.all([
      prisma.feeTransaction.findMany({
        where: { createdAt: { gte: today, lt: tomorrow } },
        include: { student: { select: { id: true, admissionNumber: true, full_name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.feeTransaction.groupBy({
        by: ['type'],
        where: { createdAt: { gte: today, lt: tomorrow } },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const credits = summary.find(s => s.type?.toUpperCase() === 'CREDIT')?._sum.amount || 0;
    const debits = summary.find(s => s.type?.toUpperCase() === 'DEBIT')?._sum.amount || 0;

    res.json({
      success: true,
      date: today.toISOString().split('T')[0],
      summary: {
        total_credits: Number(credits),
        total_debits: Number(debits),
        net_amount: Number(credits) - Number(debits),
        transaction_count: transactions.length,
      },
      transactions: transactions.map(t => ({
        id: t.id,
        student_id: t.student?.id,
        admission_number: t.student?.admissionNumber,
        full_name: t.student?.full_name,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        created_at: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Admin] Error fetching fees data:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch fees data' });
  }
});

/**
 * GET /admin/students/in-school
 */
router.get('/students/in-school', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const checkIns = await prisma.attendance.findMany({
      where: { checkType: 'IN', createdAt: { gte: today, lt: tomorrow } },
      include: { student: { select: { id: true, admissionNumber: true, full_name: true, cardUid: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const checkOuts = await prisma.attendance.findMany({
      where: { checkType: 'OUT', createdAt: { gte: today, lt: tomorrow } },
      select: { studentId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    // Track latest check-in per student
    const studentStatus = new Map<string, { checkIn: Date; checkOut?: Date }>();
    checkIns.forEach(c => {
      const existing = studentStatus.get(c.studentId!);
      if (!existing || c.createdAt! > existing.checkIn) {
        studentStatus.set(c.studentId!, { checkIn: c.createdAt! });
      }
    });
    checkOuts.forEach(c => {
      const existing = studentStatus.get(c.studentId!);
      if (existing && (!existing.checkOut || c.createdAt! > existing.checkOut)) {
        existing.checkOut = c.createdAt!;
      }
    });

    const inSchool = Array.from(studentStatus.entries())
      .filter(([_, s]) => !s.checkOut)
      .map(([studentId, s]) => {
        const ci = checkIns.find(c => c.studentId === studentId && c.createdAt?.getTime() === s.checkIn.getTime());
        return {
          student_id: studentId,
          admission_number: ci?.student?.admissionNumber,
          full_name: ci?.student?.full_name,
          card_uid: ci?.student?.cardUid,
          check_in_time: s.checkIn,
        };
      });

    res.json({ success: true, count: inSchool.length, students: inSchool });
  } catch (error) {
    console.error('[Admin] Error fetching in-school students:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch in-school students' });
  }
});

// ============================================
// STUDENTS CRUD
// ============================================

const createStudentSchema = z.object({
  admissionNumber: z.string().min(1),
  full_name: z.string().min(1),
  grade_level: z.string().min(1),
  cardUid: z.string().min(1).optional(),
  walletBalance: z.number().min(0).optional().default(0),
});

const updateStudentSchema = z.object({
  admissionNumber: z.string().min(1).optional(),
  full_name: z.string().min(1).optional(),
  grade_level: z.string().min(1).optional(),
  cardUid: z.string().min(1).optional(),
  walletBalance: z.number().min(0).optional(),
});

router.post('/students', validateBody(createStudentSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const student = await prisma.student.create({
      data: {
        admissionNumber: req.body.admissionNumber,
        full_name: req.body.full_name,
        grade_level: req.body.grade_level,
        cardUid: req.body.cardUid,
        walletBalance: new Prisma.Decimal(req.body.walletBalance ?? 0),
      },
    });

    res.status(201).json({
      success: true,
      student: {
        id: student.id,
        admission_number: student.admissionNumber,
        full_name: student.full_name,
        grade_level: student.grade_level,
        card_uid: student.cardUid,
        wallet_balance: Number(student.walletBalance),
      },
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'Conflict', message: 'Student with this admission number or card UID already exists' });
    } else {
      console.error('[Admin] Error creating student:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create student' });
    }
  }
});

router.get('/students', validateQuery(z.object({
  page: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 1),
  limit: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 50),
  search: z.string().optional(),
})), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.StudentWhereInput = {};
    if (search) {
      where.OR = [
        { admissionNumber: { contains: search, mode: 'insensitive' } },
        { full_name: { contains: search, mode: 'insensitive' } },
        { cardUid: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.student.count({ where }),
    ]);

    res.json({
      success: true,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      students: students.map(s => ({
        id: s.id,
        admission_number: s.admissionNumber,
        full_name: s.full_name,
        grade_level: s.grade_level,
        card_uid: s.cardUid,
        wallet_balance: Number(s.walletBalance),
        created_at: s.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Admin] Error fetching students:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch students' });
  }
});

router.get('/students/:id', validateParams(z.object({ id: z.string().uuid() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const student = await prisma.student.findUnique({
        where: { id: req.params.id },
        include: {
          parentStudentMaps: {
            include: { parent: { select: { id: true, full_name: true, phone_number: true, email: true } } },
          },
        },
      });

      if (!student) {
        res.status(404).json({ error: 'Not found', message: 'Student not found' });
        return;
      }

      res.json({
        success: true,
        student: {
          id: student.id,
          admission_number: student.admissionNumber,
          full_name: student.full_name,
          grade_level: student.grade_level,
          card_uid: student.cardUid,
          wallet_balance: Number(student.walletBalance),
          parents: student.parentStudentMaps.map(psm => ({
            parent_id: psm.parent.id,
            full_name: psm.parent.full_name,
            phone_number: psm.parent.phone_number,
            email: psm.parent.email,
            relationship: psm.relationship,
          })),
          created_at: student.createdAt,
        },
      });
    } catch (error) {
      console.error('[Admin] Error fetching student:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch student' });
    }
  }
);

router.put('/students/:id',
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(updateStudentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updateData: any = {};
      if (req.body.admissionNumber) updateData.admissionNumber = req.body.admissionNumber;
      if (req.body.full_name) updateData.full_name = req.body.full_name;
      if (req.body.grade_level) updateData.grade_level = req.body.grade_level;
      if (req.body.cardUid) updateData.cardUid = req.body.cardUid;
      if (req.body.walletBalance !== undefined) updateData.walletBalance = new Prisma.Decimal(req.body.walletBalance);

      const student = await prisma.student.update({ where: { id: req.params.id }, data: updateData });

      res.json({
        success: true,
        student: {
          id: student.id,
          admission_number: student.admissionNumber,
          full_name: student.full_name,
          grade_level: student.grade_level,
          card_uid: student.cardUid,
          wallet_balance: Number(student.walletBalance),
        },
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found', message: 'Student not found' });
      } else if (error.code === 'P2002') {
        res.status(409).json({ error: 'Conflict', message: 'Duplicate admission number or card UID' });
      } else {
        console.error('[Admin] Error updating student:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to update student' });
      }
    }
  }
);

router.delete('/students/:id', validateParams(z.object({ id: z.string().uuid() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.student.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: 'Student deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found', message: 'Student not found' });
      } else {
        console.error('[Admin] Error deleting student:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to delete student' });
      }
    }
  }
);

// ============================================
// STAFF CRUD
// ============================================

const createStaffSchema = z.object({
  userId: z.string().uuid(),
  full_name: z.string().min(1),
  role: z.enum(['admin', 'teacher', 'accountant']).default('teacher'),
  subject_specialty: z.string().optional(),
});

const updateStaffSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum(['admin', 'teacher', 'accountant']).optional(),
  subject_specialty: z.string().optional(),
});

router.post('/staff', validateBody(createStaffSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = await prisma.staff.create({
      data: {
        userId: req.body.userId,
        full_name: req.body.full_name,
        role: req.body.role,
        subject_specialty: req.body.subject_specialty,
      },
    });
    res.status(201).json({ success: true, staff: { id: staff.id, full_name: staff.full_name, role: staff.role } });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'Conflict', message: 'Staff with this userId already exists' });
    } else {
      console.error('[Admin] Error creating staff:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create staff' });
    }
  }
});

router.get('/staff', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const staff = await prisma.staff.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({
      success: true,
      count: staff.length,
      staff: staff.map(s => ({
        id: s.id,
        full_name: s.full_name,
        role: s.role,
        subject_specialty: s.subject_specialty,
        created_at: s.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Admin] Error fetching staff:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch staff' });
  }
});

router.put('/staff/:id',
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(updateStaffSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const staff = await prisma.staff.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.full_name && { full_name: req.body.full_name }),
          ...(req.body.role && { role: req.body.role }),
          ...(req.body.subject_specialty !== undefined && { subject_specialty: req.body.subject_specialty }),
        },
      });
      res.json({ success: true, staff: { id: staff.id, full_name: staff.full_name, role: staff.role } });
    } catch (error: any) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found', message: 'Staff member not found' });
      } else {
        console.error('[Admin] Error updating staff:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to update staff' });
      }
    }
  }
);

router.delete('/staff/:id', validateParams(z.object({ id: z.string().uuid() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.staff.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: 'Staff deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found', message: 'Staff member not found' });
      } else {
        console.error('[Admin] Error deleting staff:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to delete staff' });
      }
    }
  }
);

// ============================================
// PARENTS CRUD
// ============================================

const createParentSchema = z.object({
  userId: z.string().uuid(),
  full_name: z.string().min(1),
  phone_number: z.string().optional(),
  email: z.string().email().optional(),
});

router.post('/parents', validateBody(createParentSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parent = await prisma.parent.create({
      data: {
        userId: req.body.userId,
        full_name: req.body.full_name,
        phone_number: req.body.phone_number,
        email: req.body.email,
      },
    });
    res.status(201).json({ success: true, parent: { id: parent.id, full_name: parent.full_name, email: parent.email } });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'Conflict', message: 'Parent already exists with this userId, email, or phone' });
    } else {
      console.error('[Admin] Error creating parent:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create parent' });
    }
  }
});

router.get('/parents', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const parents = await prisma.parent.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({
      success: true,
      count: parents.length,
      parents: parents.map(p => ({
        id: p.id,
        full_name: p.full_name,
        phone_number: p.phone_number,
        email: p.email,
        created_at: p.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Admin] Error fetching parents:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch parents' });
  }
});

// ============================================
// PARENT-STUDENT LINKING
// ============================================

router.post('/parents/:parentId/students/:studentId',
  validateParams(z.object({ parentId: z.string().uuid(), studentId: z.string().uuid() })),
  validateBody(z.object({ relationship: z.string().optional() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const link = await prisma.parentStudentMap.create({
        data: {
          parentId: req.params.parentId,
          studentId: req.params.studentId,
          relationship: req.body.relationship,
        },
      });
      res.status(201).json({ success: true, link });
    } catch (error: any) {
      if (error.code === 'P2002') {
        res.status(409).json({ error: 'Conflict', message: 'Parent is already linked to this student' });
      } else {
        console.error('[Admin] Error linking parent to student:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to link parent to student' });
      }
    }
  }
);

// ============================================
// FEE TRANSACTIONS (CREDIT / DEBIT)
// ============================================

router.post('/fees/credit', validateBody(z.object({
  studentId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().optional(),
})), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { studentId, amount, description } = req.body;

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw new Error('STUDENT_NOT_FOUND');

      const newBalance = (student.walletBalance ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(amount));
      await tx.student.update({ where: { id: studentId }, data: { walletBalance: newBalance } });

      const txRecord = await tx.feeTransaction.create({
        data: { studentId, amount: new Prisma.Decimal(amount), type: 'CREDIT', description },
      });

      return { newBalance: Number(newBalance), transactionId: txRecord.id };
    });

    res.status(201).json({ success: true, new_balance: result.newBalance, transaction_id: result.transactionId });
  } catch (error: any) {
    if (error.message === 'STUDENT_NOT_FOUND') {
      res.status(404).json({ error: 'Not found', message: 'Student not found' });
    } else {
      console.error('[Admin] Error crediting wallet:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to credit wallet' });
    }
  }
});

// ============================================
// ATTENDANCE RECORDS
// ============================================

router.get('/attendance', validateQuery(z.object({
  studentId: z.string().uuid().optional(),
  date: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 1),
  limit: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 50),
})), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { studentId, date, page = 1, limit = 50 } = req.query as unknown as { studentId?: string; date?: string; page: number; limit: number };
    const skip = (page - 1) * limit;

    const where: Prisma.AttendanceWhereInput = {};
    if (studentId) where.studentId = studentId;
    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const nd = new Date(d);
      nd.setDate(nd.getDate() + 1);
      where.createdAt = { gte: d, lt: nd };
    }

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { student: { select: { admissionNumber: true, full_name: true } } },
      }),
      prisma.attendance.count({ where }),
    ]);

    res.json({
      success: true,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      attendance: records.map(a => ({
        id: a.id,
        student_id: a.studentId,
        admission_number: a.student?.admissionNumber,
        full_name: a.student?.full_name,
        check_type: a.checkType,
        device_id: a.deviceId,
        timestamp: a.createdAt,
      })),
    });
  } catch (error) {
    console.error('[Admin] Error fetching attendance:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch attendance' });
  }
});

export default router;
