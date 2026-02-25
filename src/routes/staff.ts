/**
 * Staff API Routes — aligned with actual Supabase DB schema
 *
 * DB reality:
 *  - Assignment has no studentId FK → linked by grade_level
 *  - Appointment has no studentId FK
 *  - No Grade model in DB
 *  - Staff.role is a plain String
 *  - Attendance has no device relation (deviceId is a plain String)
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';
import { requireTeacher } from '../middleware/rbac';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';

const router = Router();
router.use(authenticateJWT);

// ============================================
// ASSIGNMENTS
// ============================================

const createAssignmentSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  grade_level: z.string().min(1, 'Grade level is required'),
  dueDate: z.string().datetime('Invalid due date'),
});

const updateAssignmentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  grade_level: z.string().min(1).optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

/**
 * POST /staff/assignments
 */
router.post('/assignments',
  requireTeacher,
  validateBody(createAssignmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const staff = await prisma.staff.findFirst({ where: { userId: req.user.id } });
      if (!staff) { res.status(403).json({ error: 'Forbidden', message: 'User is not a staff member' }); return; }

      const { title, description, grade_level, dueDate } = req.body;

      const assignment = await prisma.assignment.create({
        data: {
          title,
          description,
          grade_level,
          teacherId: staff.id,
          dueDate: new Date(dueDate),
          status: 'active',
        },
      });

      res.status(201).json({
        success: true,
        assignment: {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          grade_level: assignment.grade_level,
          due_date: assignment.dueDate,
          status: assignment.status,
          created_at: assignment.createdAt,
        },
      });
    } catch (error) {
      console.error('[Staff] Error creating assignment:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create assignment' });
    }
  }
);

/**
 * GET /staff/assignments
 */
router.get('/assignments',
  requireTeacher,
  validateQuery(z.object({
    grade_level: z.string().optional(),
    status: z.enum(['active', 'archived']).optional(),
    page: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 1),
    limit: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 50),
  })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const staff = await prisma.staff.findFirst({ where: { userId: req.user.id } });
      if (!staff) { res.status(403).json({ error: 'Forbidden', message: 'User is not a staff member' }); return; }

      const query = req.query as unknown as { grade_level?: string; status?: string; page: number; limit: number };
      const { grade_level, status, page = 1, limit = 50 } = query;
      const skip = (page - 1) * limit;

      const where: Prisma.AssignmentWhereInput = { teacherId: staff.id };
      if (grade_level) where.grade_level = grade_level;
      if (status) where.status = status;

      const [assignments, total] = await Promise.all([
        prisma.assignment.findMany({ where, skip, take: limit, orderBy: { dueDate: 'asc' } }),
        prisma.assignment.count({ where }),
      ]);

      res.json({
        success: true,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        assignments: assignments.map(a => ({
          id: a.id,
          title: a.title,
          description: a.description,
          grade_level: a.grade_level,
          due_date: a.dueDate,
          status: a.status,
          created_at: a.createdAt,
        })),
      });
    } catch (error) {
      console.error('[Staff] Error fetching assignments:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch assignments' });
    }
  }
);

/**
 * PUT /staff/assignments/:id
 */
router.put('/assignments/:id',
  requireTeacher,
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(updateAssignmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const staff = await prisma.staff.findFirst({ where: { userId: req.user.id } });
      if (!staff) { res.status(403).json({ error: 'Forbidden', message: 'User is not a staff member' }); return; }

      const existing = await prisma.assignment.findUnique({ where: { id: req.params.id } });
      if (!existing) { res.status(404).json({ error: 'Not found', message: 'Assignment not found' }); return; }
      if (existing.teacherId !== staff.id) {
        res.status(403).json({ error: 'Forbidden', message: 'You can only update your own assignments' });
        return;
      }

      const updateData: Prisma.AssignmentUpdateInput = {};
      if (req.body.title) updateData.title = req.body.title;
      if (req.body.description !== undefined) updateData.description = req.body.description;
      if (req.body.grade_level) updateData.grade_level = req.body.grade_level;
      if (req.body.dueDate) updateData.dueDate = new Date(req.body.dueDate);
      if (req.body.status) updateData.status = req.body.status;

      const assignment = await prisma.assignment.update({ where: { id: req.params.id }, data: updateData });

      res.json({
        success: true,
        assignment: {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          grade_level: assignment.grade_level,
          due_date: assignment.dueDate,
          status: assignment.status,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found', message: 'Assignment not found' });
      } else {
        console.error('[Staff] Error updating assignment:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to update assignment' });
      }
    }
  }
);

/**
 * DELETE /staff/assignments/:id
 */
router.delete('/assignments/:id',
  requireTeacher,
  validateParams(z.object({ id: z.string().uuid() })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const staff = await prisma.staff.findFirst({ where: { userId: req.user.id } });
      if (!staff) { res.status(403).json({ error: 'Forbidden', message: 'User is not a staff member' }); return; }

      const existing = await prisma.assignment.findUnique({ where: { id: req.params.id } });
      if (!existing) { res.status(404).json({ error: 'Not found', message: 'Assignment not found' }); return; }
      if (existing.teacherId !== staff.id) {
        res.status(403).json({ error: 'Forbidden', message: 'You can only delete your own assignments' });
        return;
      }

      await prisma.assignment.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: 'Assignment deleted successfully' });
    } catch (error: any) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found', message: 'Assignment not found' });
      } else {
        console.error('[Staff] Error deleting assignment:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to delete assignment' });
      }
    }
  }
);

// ============================================
// APPOINTMENTS
// ============================================

const createAppointmentSchema = z.object({
  parentId: z.string().uuid('Invalid parent ID'),
  scheduledAt: z.string().datetime('Invalid scheduled time'),
  parent_notes: z.string().optional(),
});

/**
 * POST /staff/appointments
 */
router.post('/appointments',
  requireTeacher,
  validateBody(createAppointmentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const staff = await prisma.staff.findFirst({ where: { userId: req.user.id } });
      if (!staff) { res.status(403).json({ error: 'Forbidden', message: 'User is not a staff member' }); return; }

      const { parentId, scheduledAt, parent_notes } = req.body;

      // Verify parent exists
      const parent = await prisma.parent.findUnique({ where: { id: parentId } });
      if (!parent) { res.status(404).json({ error: 'Not found', message: 'Parent not found' }); return; }

      const appointment = await prisma.appointment.create({
        data: {
          teacherId: staff.id,
          parentId,
          scheduledAt: new Date(scheduledAt),
          parent_notes,
          status: 'pending',
        },
        include: {
          parent: { select: { full_name: true, phone_number: true, email: true } },
        },
      });

      res.status(201).json({
        success: true,
        appointment: {
          id: appointment.id,
          parent_name: appointment.parent?.full_name,
          parent_phone: appointment.parent?.phone_number,
          scheduled_at: appointment.scheduledAt,
          status: appointment.status,
          parent_notes: appointment.parent_notes,
          created_at: appointment.createdAt,
        },
      });
    } catch (error) {
      console.error('[Staff] Error creating appointment:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to create appointment' });
    }
  }
);

/**
 * GET /staff/appointments
 */
router.get('/appointments',
  requireTeacher,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const staff = await prisma.staff.findFirst({ where: { userId: req.user.id } });
      if (!staff) { res.status(403).json({ error: 'Forbidden', message: 'User is not a staff member' }); return; }

      const appointments = await prisma.appointment.findMany({
        where: { teacherId: staff.id },
        include: {
          parent: { select: { full_name: true, phone_number: true, email: true } },
        },
        orderBy: { scheduledAt: 'asc' },
      });

      res.json({
        success: true,
        count: appointments.length,
        appointments: appointments.map(a => ({
          id: a.id,
          parent_name: a.parent?.full_name,
          parent_phone: a.parent?.phone_number,
          scheduled_at: a.scheduledAt,
          status: a.status,
          parent_notes: a.parent_notes,
          created_at: a.createdAt,
        })),
      });
    } catch (error) {
      console.error('[Staff] Error fetching appointments:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch appointments' });
    }
  }
);

/**
 * PUT /staff/appointments/:id/status
 */
router.put('/appointments/:id/status',
  requireTeacher,
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(z.object({ status: z.enum(['pending', 'confirmed', 'cancelled']) })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const staff = await prisma.staff.findFirst({ where: { userId: req.user.id } });
      if (!staff) { res.status(403).json({ error: 'Forbidden', message: 'User is not a staff member' }); return; }

      const existing = await prisma.appointment.findUnique({ where: { id: req.params.id } });
      if (!existing) { res.status(404).json({ error: 'Not found', message: 'Appointment not found' }); return; }
      if (existing.teacherId !== staff.id) {
        res.status(403).json({ error: 'Forbidden', message: 'You can only update your own appointments' });
        return;
      }

      const appointment = await prisma.appointment.update({
        where: { id: req.params.id },
        data: { status: req.body.status },
      });

      res.json({ success: true, appointment: { id: appointment.id, status: appointment.status } });
    } catch (error: any) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Not found', message: 'Appointment not found' });
      } else {
        console.error('[Staff] Error updating appointment status:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Failed to update appointment' });
      }
    }
  }
);

// ============================================
// STUDENTS (read-only for teachers)
// ============================================

/**
 * GET /staff/students
 * Teachers can browse students by grade level
 */
router.get('/students',
  requireTeacher,
  validateQuery(z.object({
    grade_level: z.string().optional(),
    search: z.string().optional(),
    page: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 1),
    limit: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 50),
  })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = req.query as unknown as { grade_level?: string; search?: string; page: number; limit: number };
      const { grade_level, search, page = 1, limit = 50 } = query;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (grade_level) where.grade_level = grade_level;
      if (search) {
        where.OR = [
          { admissionNumber: { contains: search, mode: 'insensitive' } },
          { full_name: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [students, total] = await Promise.all([
        prisma.student.findMany({
          where,
          skip,
          take: limit,
          select: { id: true, admissionNumber: true, full_name: true, grade_level: true, walletBalance: true, createdAt: true },
        }),
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
          wallet_balance: Number(s.walletBalance ?? 0),
          created_at: s.createdAt,
        })),
      });
    } catch (error) {
      console.error('[Staff] Error fetching students:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch students' });
    }
  }
);

// ============================================
// ATTENDANCE (read for teachers)
// ============================================

/**
 * GET /staff/attendance
 */
router.get('/attendance',
  requireTeacher,
  validateQuery(z.object({
    studentId: z.string().uuid().optional(),
    grade_level: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 1),
    limit: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : 50),
  })),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = req.query as unknown as { studentId?: string; grade_level?: string; startDate?: string; endDate?: string; page: number; limit: number };
      const { studentId, grade_level, startDate, endDate, page = 1, limit = 50 } = query;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (studentId) where.studentId = studentId;

      // If filtering by grade_level, first get students at that level
      if (grade_level && !studentId) {
        const students = await prisma.student.findMany({
          where: { grade_level },
          select: { id: true },
        });
        where.studentId = { in: students.map(s => s.id) };
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) { const s = new Date(startDate); s.setHours(0, 0, 0, 0); where.createdAt.gte = s; }
        if (endDate) { const e = new Date(endDate); e.setHours(23, 59, 59, 999); where.createdAt.lte = e; }
      }

      const [attendance, total] = await Promise.all([
        prisma.attendance.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            student: { select: { id: true, admissionNumber: true, full_name: true, grade_level: true } },
          },
        }),
        prisma.attendance.count({ where }),
      ]);

      res.json({
        success: true,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        attendance: attendance.map(a => ({
          id: a.id,
          student_id: a.studentId,
          admission_number: a.student?.admissionNumber,
          full_name: a.student?.full_name,
          grade_level: a.student?.grade_level,
          check_type: a.checkType,
          device_id: a.deviceId,
          timestamp: a.createdAt,
        })),
      });
    } catch (error) {
      console.error('[Staff] Error fetching attendance:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch attendance' });
    }
  }
);

export default router;
