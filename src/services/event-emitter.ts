/**
 * Event Emitter Service
 * Centralized event system for real-time notifications
 */

import { EventEmitter } from 'events';

export interface TapEvent {
  studentId: string;
  studentName: string;
  deviceId: string;
  deviceLocation: string;
  devicePurpose: string;
  checkType?: string;
  status?: string;
  timestamp: Date;
}

export interface FeeUpdateEvent {
  studentId: string;
  studentName: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  newBalance: number;
  timestamp: Date;
}

export interface AttendanceEvent {
  studentId: string;
  studentName: string;
  checkType: 'IN' | 'OUT';
  status: 'ON_TIME' | 'LATE';
  timestamp: Date;
}

export interface GradeEvent {
  studentId: string;
  studentName: string;
  subject: string;
  score: number;
  maxScore: number;
  timestamp: Date;
}

class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emitTapEvent(event: TapEvent): void {
    this.emit('nfc:tap', event);
    console.log(`[EventEmitter] NFC tap event emitted for student: ${event.studentId}`);
  }

  emitFeeUpdate(event: FeeUpdateEvent): void {
    this.emit('fee:update', event);
    console.log(`[EventEmitter] Fee update event emitted for student: ${event.studentId}`);
  }

  emitAttendance(event: AttendanceEvent): void {
    this.emit('attendance:update', event);
    console.log(`[EventEmitter] Attendance event emitted for student: ${event.studentId}`);
  }

  emitGrade(event: GradeEvent): void {
    this.emit('grade:new', event);
    console.log(`[EventEmitter] Grade event emitted for student: ${event.studentId}`);
  }
}

export const appEvents = new AppEventEmitter();
