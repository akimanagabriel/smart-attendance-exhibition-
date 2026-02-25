# 🏛️ Smart Campus Hub - Backend

Production-ready backend system for Smart Campus Hub, integrating NFC/RFID smart cards, attendance tracking, smart wallet payments, academic management, and parent monitoring.

## 🚀 Features

- **MQTT IoT Gateway**: Real-time NFC/RFID card tap processing
- **RESTful API**: Secure endpoints for admin, parent, and staff portals
- **Supabase Integration**: JWT authentication and PostgreSQL database
- **Role-Based Access Control**: Admin, Teacher, Accountant, and Parent roles
- **Financial Transactions**: Atomic wallet operations with Prisma transactions
- **Real-time Attendance**: Live tracking of students in school
- **Production-Ready**: Security, validation, error handling, and logging

## 📋 Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (Supabase)
- MQTT broker (for IoT device integration)
- Supabase project with authentication enabled

## 🛠️ Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your actual values:
   - `DATABASE_URL`: Supabase PostgreSQL connection string
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_ANON_KEY`: Your Supabase anon key
   - `MQTT_BROKER_URL`: MQTT broker URL (e.g., `mqtt://localhost:1883`)

3. **Set up Prisma:**
   ```bash
   # Generate Prisma Client
   npm run prisma:generate

   # Run migrations (if needed)
   npm run prisma:migrate
   ```

## 🏃 Running the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

The server will start on `http://localhost:3000` (or your configured PORT).

## 📡 MQTT Integration

The system subscribes to `school/nfc/tap` topic and publishes responses to `school/devices/{device_id}/res`.

### Incoming Payload Format:
```json
{
  "card_uid": "string",
  "device_id": "string"
}
```

### Response Format:
```json
{
  "success": true,
  "student_name": "John Doe",
  "wallet_balance": 4500,
  "clearance_warning": false,
  "message": "Access Granted"
}
```

## 🔐 API Endpoints

### Admin Endpoints (Requires Admin Role)
- `GET /api/admin/attendance/live` - Get live attendance (students in school)
- `GET /api/admin/lateness` - Get list of late students
- `GET /api/admin/fees/today` - Get today's fee transactions
- `GET /api/admin/students/in-school` - Get students currently in school

### Parent Endpoints (Requires Parent Authentication)
- `GET /api/parent/students` - Get all children
- `GET /api/parent/attendance/:studentId` - Get attendance for a child
- `GET /api/parent/financial/:studentId` - Get financial info for a child
- `GET /api/parent/assignments/:studentId` - Get assignments for a child

### Staff Endpoints (Requires Staff Role)
- `POST /api/staff/assignments` - Create assignment (Teachers)
- `POST /api/staff/appointments` - Create appointment (Teachers)
- `GET /api/staff/students` - Get assigned students (Teachers)

## 🔒 Security

- **JWT Authentication**: All protected routes verify Supabase JWT tokens
- **RBAC**: Role-based access control enforced at middleware level
- **Ownership Checks**: Parents can only access their own children's data
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Helmet**: Security headers enabled
- **Input Validation**: Zod schemas validate all inputs

## 📊 Database Schema

The Prisma schema includes:
- **Students**: Card UID, wallet balance, fees
- **Parents**: Linked to Supabase auth users
- **Staff**: Teachers, accountants, admins
- **Devices**: NFC/RFID devices with purpose (ATTENDANCE, CANTEEN, CLEARANCE)
- **Attendance**: Check-in/out records with status
- **FeeTransactions**: Credit/debit transactions
- **Assignments**: Teacher-student assignments
- **Appointments**: Parent-teacher meetings

## 🧪 Development

**Prisma Studio** (Database GUI):
```bash
npm run prisma:studio
```

**TypeScript Compilation:**
```bash
npm run build
```

## 📝 Environment Variables

See `.env.example` for all required environment variables.

## 🏗️ Architecture

```
src/
 ├── config/          # Database and Supabase configuration
 ├── middleware/      # Auth, RBAC, validation middleware
 ├── mqtt/           # MQTT handler for IoT integration
 ├── routes/         # API route handlers
 └── index.ts        # Main server entry point
```

## 🚨 Critical System Rules

1. **Financial Atomicity**: All wallet deductions use Prisma transactions with row locking
2. **Clearance Check**: Global rule - students with outstanding fees get clearance warnings
3. **Ownership Enforcement**: Backend validates parent-student relationships
4. **Device Purpose Branching**: Different logic for ATTENDANCE vs CANTEEN/CLEARANCE devices

## 📄 License

ISC
