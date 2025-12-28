import { Response } from 'express';
import sendHTTPResponse from '../../common/sendHTTPResponse';
import logger from '../../config/logger';
import { ExternalCommunicationService } from '../../services/externalCommunication.service';
import { SDKRequest } from '../../middleware/sdk.middleware';

// Initialize visitor session
export const initializeVisitorRoute = async (req: SDKRequest, res: Response) => {
    try {
        const { name, email, phone, sessionId, userAgent, referrerUrl } = req.body;
        const tenantId = req.tenantId!;
        const ipAddress = req.ip;

        // Validate required fields
        if (!name || !sessionId) {
            return sendHTTPResponse.error(res, 400, 'Name and session ID are required');
        }

        // Build visitor data object with proper optional property handling
        const visitorData: {
            name: string;
            email?: string;
            phone?: string;
            sessionId: string;
            ipAddress?: string;
            userAgent?: string;
            referrerUrl?: string;
        } = {
            name: String(name),
            sessionId: String(sessionId)
        };

        // Only add optional properties if they have values
        if (email) visitorData.email = String(email);
        if (phone) visitorData.phone = String(phone);
        if (ipAddress) visitorData.ipAddress = ipAddress;
        if (userAgent) visitorData.userAgent = String(userAgent);
        if (referrerUrl) visitorData.referrerUrl = String(referrerUrl);

        const visitor = await ExternalCommunicationService.initializeVisitorSession(tenantId, visitorData);

        const responseData = {
            visitor: {
                id: visitor.id,
                name: visitor.name,
                email: visitor.email,
                session_id: visitor.session_id,
                status: visitor.status
            },
            tenant: {
                id: tenantId,
                branding: req.sdkSettings?.branding,
                widget_config: req.sdkSettings?.widget_config
            }
        };

        logger.info(`Visitor session initialized: ${visitor.id} for tenant: ${tenantId}`);
        return sendHTTPResponse.success(res, 201, 'Visitor session initialized', responseData);

    } catch (error: any) {
        logger.error({ error }, 'Initialize visitor error');
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

// Start external chat conversation
export const startExternalChatRoute = async (req: SDKRequest, res: Response) => {
    try {
        const { visitorId, initialMessage } = req.body;
        const tenantId = req.tenantId!;

        if (!visitorId) {
            return sendHTTPResponse.error(res, 400, 'Visitor ID is required');
        }

        const result = await ExternalCommunicationService.startExternalConversation(
            tenantId,
            visitorId,
            initialMessage
        );

        const responseData = {
            conversation: {
                id: result.conversation.id,
                status: result.conversation.status,
                created_at: result.conversation.created_at
            },
            assigned_agent: result.assignedAgent ? {
                id: result.assignedAgent.id,
                name: result.assignedAgent.name
            } : null,
            welcome_message: result.welcomeMessage,
            queue_position: result.queuePosition,
            estimated_wait_time: result.queuePosition ? result.queuePosition * 2 : 0 // 2 minutes per position
        };

        logger.info(`External chat started: ${result.conversation.id} for visitor: ${visitorId} in tenant: ${tenantId}`);
        return sendHTTPResponse.success(res, 201, 'Chat started successfully', responseData);

    } catch (error: any) {
        logger.error({ error }, 'Start external chat error');
        if (error.message === 'Visitor not found') {
            return sendHTTPResponse.error(res, 404, error.message);
        }
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

// Send message in external conversation
export const sendExternalMessageRoute = async (req: SDKRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const { visitorId, content, messageType = 'text' } = req.body;
        const tenantId = req.tenantId!;

        if (!conversationId || !visitorId || !content) {
            return sendHTTPResponse.error(res, 400, 'Conversation ID, visitor ID, and content are required');
        }

        // Verify conversation belongs to visitor and tenant
        const conversation = await ExternalCommunicationService.getExternalConversationById(tenantId, conversationId);
        if (!conversation || conversation.visitor_id !== visitorId) {
            return sendHTTPResponse.error(res, 404, 'Conversation not found or access denied');
        }

        // Update visitor activity
        await ExternalCommunicationService.updateVisitorActivity(tenantId, visitorId);

        // For now, store the message directly (you'll need to create a message service for external messages)
        // This is a placeholder - you would implement ExternalMessageService
        const messageData = {
            id: `msg_${Date.now()}`, // Temporary ID generation
            conversation_id: conversationId,
            sender_type: 'visitor',
            sender_id: visitorId,
            content,
            message_type: messageType,
            created_at: new Date()
        };

        logger.info(`External message sent: ${messageData.id} in conversation: ${conversationId}`);
        return sendHTTPResponse.success(res, 201, 'Message sent successfully', { message: messageData });

    } catch (error: any) {
        logger.error({ error }, 'Send external message error');
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

// Get messages for external conversation
export const getExternalMessagesRoute = async (req: SDKRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const { visitorId, since } = req.query;
        const tenantId = req.tenantId!;

        if (!conversationId || !visitorId) {
            return sendHTTPResponse.error(res, 400, 'Conversation ID and visitor ID are required');
        }

        // Verify conversation belongs to visitor and tenant
        const conversation = await ExternalCommunicationService.getExternalConversationById(tenantId, conversationId);
        if (!conversation || conversation.visitor_id !== visitorId as string) {
            return sendHTTPResponse.error(res, 404, 'Conversation not found or access denied');
        }

        // Update visitor activity
        await ExternalCommunicationService.updateVisitorActivity(tenantId, visitorId as string);

        // This is a placeholder for getting external messages
        // You would implement ExternalMessageService.getMessages()
        const messages: any[] = []; // Placeholder

        const responseData = {
            messages,
            conversation_id: conversationId,
            has_more: false
        };

        return sendHTTPResponse.success(res, 200, 'Messages retrieved successfully', responseData);

    } catch (error: any) {
        logger.error({ error }, 'Get external messages error');
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

// End external conversation
export const endExternalChatRoute = async (req: SDKRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const { visitorId, satisfactionRating } = req.body;
        const tenantId = req.tenantId!;

        if (!conversationId || !visitorId) {
            return sendHTTPResponse.error(res, 400, 'Conversation ID and visitor ID are required');
        }

        // Verify conversation belongs to visitor and tenant
        const conversation = await ExternalCommunicationService.getExternalConversationById(tenantId, conversationId);
        if (!conversation || conversation.visitor_id !== visitorId) {
            return sendHTTPResponse.error(res, 404, 'Conversation not found or access denied');
        }

        await ExternalCommunicationService.endExternalConversation(
            tenantId,
            conversationId,
            satisfactionRating
        );

        logger.info(`External chat ended: ${conversationId} by visitor: ${visitorId} in tenant: ${tenantId}`);
        return sendHTTPResponse.success(res, 200, 'Chat ended successfully');

    } catch (error: any) {
        logger.error({ error }, 'End external chat error');
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

// Get queue status
export const getQueueStatusRoute = async (req: SDKRequest, res: Response) => {
    try {
        const tenantId = req.tenantId!;

        const stats = await ExternalCommunicationService.getTenantExternalStats(tenantId);

        const responseData = {
            queue_length: stats.queueLength,
            average_wait_time: Math.round(stats.averageWaitTime / 60), // Convert to minutes
            agents_online: stats.activeConversations > 0, // Simplified check
            estimated_wait: stats.queueLength * 2 // 2 minutes per position
        };

        return sendHTTPResponse.success(res, 200, 'Queue status retrieved', responseData);

    } catch (error: any) {
        logger.error({ error }, 'Get queue status error');
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};
