// conversation.controller.ts
import { Request, Response } from 'express';

export const getAllMessages = (req: Request, res: Response) => {
  res.json({ success: true, data: "Here are the messages" });
};