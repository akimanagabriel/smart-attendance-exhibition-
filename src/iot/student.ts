import express from "express";
import prisma from "../config/database";
const studentRoutes: express.Router = express.Router();

// receive card id
type BodyPayload = {
  card: string;
};

// Register new student
studentRoutes.post(
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

export default studentRoutes;
