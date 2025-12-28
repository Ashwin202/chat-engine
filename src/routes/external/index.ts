import { Router } from 'express';
import { 
    initializeVisitorRoute,
    startExternalChatRoute,
    sendExternalMessageRoute,
    getExternalMessagesRoute,
    endExternalChatRoute,
    getQueueStatusRoute
} from './controller';
import { validateSDKKey } from '../../middleware/sdk.middleware';

const router = Router();

// Apply SDK key validation to all external routes
router.use(validateSDKKey);

// External communication routes (used by chat SDK)
router.post('/visitor/init', initializeVisitorRoute);              // Initialize website visitor session
router.post('/chat/start', startExternalChatRoute);                // Start customer chat with agent assignment/queue
router.post('/chat/:conversationId/messages', sendExternalMessageRoute);  // Send message from customer to agent
router.get('/chat/:conversationId/messages', getExternalMessagesRoute);   // Get chat message history for customer
router.post('/chat/:conversationId/end', endExternalChatRoute);    // End customer chat session with satisfaction rating
router.get('/queue/status', getQueueStatusRoute);                  // Get current queue status and wait times

export default router;
