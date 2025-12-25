// routes.ts
import { Router } from 'express';
import { getAllConversations, getConversationById } from './controller';
import messagesRouter from './messages';

const router = Router();

router.use('/messages', messagesRouter);

router.get('/', getAllConversations);
router.get('/:id', getConversationById);

export default router;
