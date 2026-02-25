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

export default iot;
