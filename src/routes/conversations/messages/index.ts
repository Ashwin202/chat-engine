// routes.ts
import { Router } from 'express';
import { getAllMessages } from './controller';

const router = Router();

router.get('/', getAllMessages);

export default router;