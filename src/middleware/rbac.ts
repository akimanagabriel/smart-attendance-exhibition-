/**
 * Role-Based Access Control (RBAC) Middleware
 * DB reality: Staff.role is a plain String (e.g. "admin", "teacher", "accountant")
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import prisma from '../config/database';

// Role constants matching what's stored in DB
export const ROLES = {
  ADMIN: 'admin',
  TEACHER: 'teacher',
  ACCOUNTANT: 'accountant',
} as const;

export type AppRole = typeof ROLES[keyof typeof ROLES];

/**
 * Middleware to require specific staff roles (case-insensitive string match)
 */
export function requireRole(...allowedRoles: string[]) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
        return;
      }

      const staff = await prisma.staff.findFirst({
        where: { userId: req.user.id },
      });

      if (!staff) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'User is not a staff member',
        });
        return;
      }

      const staffRole = (staff.role || '').toLowerCase();
      const allowed = allowedRoles.map(r => r.toLowerCase());

      if (!allowed.includes(staffRole)) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}`,
        });
        return;
      }

      req.user.role = staff.role ?? undefined;
      next();
    } catch (error) {
      console.error('[RBAC] Error checking role:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Authorization check failed',
      });
    }
  };
}

export const requireAdmin = requireRole(ROLES.ADMIN);
export const requireTeacher = requireRole(ROLES.TEACHER, ROLES.ADMIN);
export const requireAccountant = requireRole(ROLES.ACCOUNTANT, ROLES.ADMIN);

/**
 * Middleware to verify parent ownership of student
 */
export async function verifyParentOwnership(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const studentId = req.params.studentId;
    if (!studentId) {
      res.status(400).json({ error: 'Bad request', message: 'Student ID is required' });
      return;
    }

    const parent = await prisma.parent.findFirst({
      where: { userId: req.user.id },
    });

    if (!parent) {
      res.status(403).json({ error: 'Forbidden', message: 'User is not a parent' });
      return;
    }

    const parentStudentMap = await prisma.parentStudentMap.findFirst({
      where: { parentId: parent.id, studentId },
    });

    if (!parentStudentMap) {
      res.status(403).json({ error: 'Forbidden', message: 'You do not have access to this student' });
      return;
    }

    (req as any).parentId = parent.id;
    (req as any).studentId = studentId;

    next();
  } catch (error) {
    console.error('[RBAC] Error verifying parent ownership:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Ownership verification failed' });
  }
}
