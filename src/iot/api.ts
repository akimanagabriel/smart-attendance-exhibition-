import express from "express";
import prisma from "../config/database";
const iot: express.Router = express.Router();

// receive card id
type BodyPayload = {
  card: string;
};

iot.post("/card", async (req: express.Request, res: express.Response) => {
  const { card }: BodyPayload = req.body;
  const existing = await prisma.cards.findUnique({
    where: { identifier: card },
  });

  if (existing) {
    return res
      .status(409)
      .json({ message: "Card already exists", data: existing });
  }
  const data = await prisma.cards.create({ data: { identifier: card } });
  return res
    .status(201)
    .json({ message: "New card registered successfully", data });
});

iot.get("/card", async (req: express.Request, res: express.Response) => {
  const cards = await prisma.cards.findMany();
  res.json(cards);
});

// Assign card to student
iot.patch(
  "/card/:identifier/assign",
  async (req: express.Request, res: express.Response) => {
    try {
      const { identifier } = req.params;
      const { studentId } = req.body;

      // Validate input
      if (!studentId) {
        return res.status(400).json({
          message: "studentId is required",
        });
      }

      // Check if student exists
      const student = await prisma.student.findUnique({
        where: { id: studentId },
      });

      if (!student) {
        return res.status(404).json({
          message: "Student not found",
        });
      }

      // Check if card exists
      const card = await prisma.cards.findUnique({
        where: { identifier },
      });

      if (!card) {
        return res.status(404).json({
          message: "Card not found",
        });
      }

      // Check if card is already assigned to another student
      if (card.student_id && card.student_id !== studentId) {
        return res.status(409).json({
          message: "Card is already assigned to another student",
        });
      }

      // Assign card to student
      const updatedCard = await prisma.cards.update({
        where: { identifier },
        data: { student_id: studentId },
        include: {
          student: {
            select: {
              id: true,
              full_name: true,
              admission_number: true,
              grade_level: true,
            },
          },
        },
      });

      return res.json({
        message: "Card assigned successfully",
        data: updatedCard,
      });
    } catch (error) {
      console.error("Error assigning card:", error);
      return res.status(500).json({
        message: "Internal server error",
      });
    }
  },
);

iot.post(
  "/student/register",
  async (req: express.Request, res: express.Response) => {
    try {
      const {
        admission_number,
        full_name,
        grade_level,
        card_identifier, // optional: if you want to assign a card during registration
      } = req.body;

      // Validate required fields
      if (!admission_number || !full_name || !grade_level) {
        return res.status(400).json({
          message: "admission_number, full_name, and grade_level are required",
        });
      }

      // Check if student with same admission number already exists
      const existingStudent = await prisma.student.findUnique({
        where: { admission_number },
      });

      if (existingStudent) {
        return res.status(409).json({
          message: "Student with this admission number already exists",
        });
      }

      // If card identifier is provided, check if it exists and is not assigned
      if (card_identifier) {
        const card = await prisma.cards.findUnique({
          where: { identifier: card_identifier },
        });

        if (!card) {
          return res.status(404).json({
            message: "Card not found",
          });
        }

        if (card.student_id) {
          return res.status(409).json({
            message: "Card is already assigned to another student",
          });
        }
      }

      // Create student and optionally assign card in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create the student
        const newStudent = await tx.student.create({
          data: {
            admission_number,
            full_name,
            grade_level,
            wallet_balance: 0.0, // initialize with zero balance
          },
        });

        // If card identifier provided, assign it to the student
        if (card_identifier) {
          await tx.cards.update({
            where: { identifier: card_identifier },
            data: { student_id: newStudent.id },
          });
        }

        // Return student with card info if applicable
        return tx.student.findUnique({
          where: { id: newStudent.id },
          include: {
            cards: card_identifier
              ? {
                  where: { identifier: card_identifier },
                }
              : false,
          },
        });
      });

      return res.status(201).json({
        message: "Student registered successfully",
        data: result,
      });
    } catch (error) {
      console.error("Error registering student:", error);
      return res.status(500).json({
        message: "Internal server error",
      });
    }
  },
);

export default iot;
