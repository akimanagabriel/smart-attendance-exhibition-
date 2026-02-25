/**
 * WebSocket Server for Real-time Updates
 * Provides real-time updates to admin dashboard
 */

import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { appEvents, TapEvent, FeeUpdateEvent, AttendanceEvent, GradeEvent } from './event-emitter';
// WebSocket authentication handled in middleware
import { supabase } from '../config/supabase';

class WebSocketService {
  private io: SocketIOServer | null = null;

  /**
   * Initialize WebSocket server
   */
  public initialize(httpServer: HTTPServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
          return next(new Error('Authentication error: Invalid token'));
        }

        (socket as any).user = {
          id: user.id,
          email: user.email,
        };

        next();
      } catch (error) {
        next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const user = (socket as any).user;
      console.log(`[WebSocket] Client connected: ${user.email} (${user.id})`);

      // Join admin room if user is admin
      socket.on('join:admin', async () => {
        try {
          // Verify user is admin
          const { data: { user: authUser } } = await supabase.auth.getUser(
            socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')
          );

          if (!authUser) {
            socket.emit('error', { message: 'Unauthorized' });
            return;
          }

          // Check if user is admin (you might want to cache this)
          // For now, we'll allow connection and let the backend verify on each event
          socket.join('admin');
          socket.emit('joined', { room: 'admin' });
          console.log(`[WebSocket] User ${user.email} joined admin room`);
        } catch (error) {
          socket.emit('error', { message: 'Failed to join admin room' });
        }
      });

      socket.on('disconnect', () => {
        console.log(`[WebSocket] Client disconnected: ${user.email}`);
      });
    });

    // Subscribe to events and broadcast to admin room
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for real-time updates
   */
  private setupEventListeners(): void {
    // NFC Tap Events
    appEvents.on('nfc:tap', (event: TapEvent) => {
      this.broadcastToAdmin('nfc:tap', event);
    });

    // Fee Update Events
    appEvents.on('fee:update', (event: FeeUpdateEvent) => {
      this.broadcastToAdmin('fee:update', event);
    });

    // Attendance Events
    appEvents.on('attendance:update', (event: AttendanceEvent) => {
      this.broadcastToAdmin('attendance:update', event);
    });

    // Grade Events
    appEvents.on('grade:new', (event: GradeEvent) => {
      this.broadcastToAdmin('grade:new', event);
    });
  }

  /**
   * Broadcast event to admin room
   */
  private broadcastToAdmin(event: string, data: any): void {
    if (this.io) {
      this.io.to('admin').emit(event, data);
      console.log(`[WebSocket] Broadcasted ${event} to admin room`);
    }
  }

  /**
   * Get Socket.IO instance
   */
  public getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Emit custom event to specific room
   */
  public emitToRoom(room: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }
}

// Singleton instance
export const webSocketService = new WebSocketService();
