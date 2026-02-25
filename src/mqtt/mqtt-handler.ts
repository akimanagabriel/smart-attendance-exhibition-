/**
 * MQTT IoT Gateway Handler
 * Aligned with actual Supabase DB schema (db pull verified)
 *
 * DB Reality:
 * - No Device model  → device_id stored as raw String on Attendance
 * - No Attendance.status / .timestamp → uses .checkType (String?) and .createdAt
 * - Student has NO totalFees / feesPaid → walletBalance only
 * - Staff.role is a plain String, not an enum
 */

import mqtt, { MqttClient } from 'mqtt';
import { z } from 'zod';
import prisma from '../config/database';
import { appEvents } from '../services/event-emitter';

// ============================================
// ZOD VALIDATION SCHEMAS
// ============================================

const NFCTapPayloadSchema = z.object({
  card_uid: z.string().min(1, 'Card UID is required'),
  device_id: z.string().min(1, 'Device ID is required'),
});

type NFCTapPayload = z.infer<typeof NFCTapPayloadSchema>;

interface DeviceResponse {
  success: boolean;
  student_name?: string;
  admission_number?: string;
  wallet_balance?: number;
  message?: string;
  error?: string;
  check_type?: string;
}

// ============================================
// MQTT CONFIGURATION
// ============================================

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const MQTT_TOPIC_SUBSCRIBE = 'school/nfc/tap';
const MQTT_TOPIC_PUBLISH_PREFIX = 'school/devices';

// ============================================
// MQTT CLIENT SETUP
// ============================================

class MQTTHandler {
  private client: MqttClient | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.client = mqtt.connect(MQTT_BROKER_URL, {
          clientId: `smart-campus-hub-${Date.now()}`,
          clean: true,
          reconnectPeriod: this.reconnectDelay,
          connectTimeout: 30000,
        });

        this.client.on('connect', () => {
          console.log(`[MQTT] Connected to broker: ${MQTT_BROKER_URL}`);
          this.reconnectAttempts = 0;
          this.subscribe();
          resolve();
        });

        this.client.on('error', (error) => {
          console.error('[MQTT] Connection error:', error);
          reject(error);
        });

        this.client.on('close', () => {
          console.warn('[MQTT] Connection closed');
        });

        this.client.on('reconnect', () => {
          this.reconnectAttempts++;
          console.log(`[MQTT] Reconnecting... (attempt ${this.reconnectAttempts})`);
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[MQTT] Max reconnection attempts reached');
            this.client?.end();
          }
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message.toString());
        });

        this.client.on('offline', () => {
          console.warn('[MQTT] Client went offline');
        });

      } catch (error) {
        console.error('[MQTT] Failed to initialize client:', error);
        reject(error);
      }
    });
  }

  private subscribe(): void {
    if (!this.client) throw new Error('MQTT client not initialized');

    this.client.subscribe(MQTT_TOPIC_SUBSCRIBE, { qos: 1 }, (error) => {
      if (error) {
        console.error(`[MQTT] Failed to subscribe to ${MQTT_TOPIC_SUBSCRIBE}:`, error);
      } else {
        console.log(`[MQTT] Subscribed to topic: ${MQTT_TOPIC_SUBSCRIBE}`);
      }
    });
  }

  private async handleMessage(topic: string, payload: string): Promise<void> {
    try {
      console.log(`[MQTT] Received message on topic: ${topic}`);

      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(payload);
      } catch {
        console.error('[MQTT] Invalid JSON payload');
        return;
      }

      const validationResult = NFCTapPayloadSchema.safeParse(parsedPayload);
      if (!validationResult.success) {
        console.error('[MQTT] Validation error:', validationResult.error);
        const deviceId = (parsedPayload as any)?.device_id || 'unknown';
        await this.publishErrorResponse(deviceId, 'Invalid payload structure');
        return;
      }

      await this.processNFCTap(validationResult.data);

    } catch (error) {
      console.error('[MQTT] Error handling message:', error);
      try {
        const parsed = JSON.parse(payload);
        await this.publishErrorResponse((parsed as any)?.device_id || 'unknown', 'Internal server error');
      } catch { /* ignore */ }
    }
  }

  /**
   * Process NFC card tap
   * DB reality: no Device model, no Attendance.status, use createdAt as timestamp
   */
  private async processNFCTap(payload: NFCTapPayload): Promise<void> {
    const { card_uid, device_id } = payload;

    try {
      // Step 1: Find Student by card_uid
      const student = await prisma.student.findUnique({
        where: { cardUid: card_uid },
      });

      if (!student) {
        console.warn(`[MQTT] Student not found for card_uid: ${card_uid}`);
        await this.publishErrorResponse(device_id, 'Student not found');
        return;
      }

      // Step 2: Handle attendance (toggle IN/OUT)
      const response = await this.handleAttendance(student.id, device_id);

      // Add student info to response
      response.student_name = student.full_name;
      response.admission_number = student.admissionNumber;
      response.wallet_balance = student.walletBalance ? Number(student.walletBalance) : 0;

      // Emit tap event for real-time dashboard
      appEvents.emitTapEvent({
        studentId: student.id,
        studentName: student.full_name,
        deviceId: device_id,
        deviceLocation: `Device ${device_id}`,
        devicePurpose: 'ATTENDANCE',
        checkType: response.check_type,
        timestamp: new Date(),
      });

      await this.publishResponse(device_id, response);

    } catch (error) {
      console.error('[MQTT] Error processing NFC tap:', error);
      await this.publishErrorResponse(device_id, 'Processing error occurred');
    }
  }

  /**
   * Handle attendance check-in/out
   * Uses Attendance.checkType (String) and Attendance.createdAt (no separate timestamp column)
   */
  private async handleAttendance(
    studentId: string,
    deviceId: string,
  ): Promise<DeviceResponse> {
    try {
      const now = new Date();
      const checkTimeMinutes = now.getHours() * 60 + now.getMinutes();
      const lateThresholdMinutes = 8 * 60; // 08:00

      // Determine IN or OUT based on last record
      const lastAttendance = await prisma.attendance.findFirst({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
      });

      const checkType: 'IN' | 'OUT' =
        lastAttendance?.checkType === 'IN' ? 'OUT' : 'IN';

      // Create attendance record (uses createdAt as timestamp, stored device_id as string)
      await prisma.attendance.create({
        data: {
          studentId,
          checkType,
          deviceId, // stored as raw string — no Device FK in DB
        },
      });

      // Emit attendance event
      appEvents.emitAttendance({
        studentId,
        studentName: studentId, // will be overwritten with real name upstream
        checkType: checkType as 'IN' | 'OUT',
        status: checkType === 'IN' && checkTimeMinutes > lateThresholdMinutes ? 'LATE' : 'ON_TIME',
        timestamp: now,
      });

      const isLate = checkType === 'IN' && checkTimeMinutes > lateThresholdMinutes;
      const message =
        checkType === 'IN'
          ? isLate
            ? 'Late check-in recorded'
            : 'Check-in successful'
          : 'Check-out successful';

      return {
        success: true,
        message,
        check_type: checkType,
      };

    } catch (error) {
      console.error('[MQTT] Error handling attendance:', error);
      return {
        success: false,
        error: 'Failed to record attendance',
      };
    }
  }

  private async publishResponse(deviceId: string, response: DeviceResponse): Promise<void> {
    if (!this.client) {
      console.error('[MQTT] Cannot publish: client not initialized');
      return;
    }

    const topic = `${MQTT_TOPIC_PUBLISH_PREFIX}/${deviceId}/res`;
    const payload = JSON.stringify(response);

    this.client.publish(topic, payload, { qos: 1 }, (error) => {
      if (error) {
        console.error(`[MQTT] Failed to publish response to ${topic}:`, error);
      } else {
        console.log(`[MQTT] Published response to ${topic}:`, response);
      }
    });
  }

  private async publishErrorResponse(deviceId: string, errorMessage: string): Promise<void> {
    await this.publishResponse(deviceId, { success: false, error: errorMessage });
  }

  public async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end(false, {}, () => {
          console.log('[MQTT] Disconnected gracefully');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public isConnected(): boolean {
    return this.client?.connected ?? false;
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let mqttHandlerInstance: MQTTHandler | null = null;

export function getMQTTHandler(): MQTTHandler {
  if (!mqttHandlerInstance) {
    mqttHandlerInstance = new MQTTHandler();
  }
  return mqttHandlerInstance;
}

export default MQTTHandler;
