// conversation.controller.ts
import { Request, Response } from 'express';

export const getAllConversations = (req: Request, res: Response) => {

  res.json({ success: true, data: [] });
};

// GET /conversations/:id
export const getConversationById = (req: Request, res: Response) => {
  const { id } = req.params;

  res.json({ success: true, data: "conversation" });
};