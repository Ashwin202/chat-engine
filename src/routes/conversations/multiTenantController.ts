import { Request, Response } from 'express';
import sendHTTPResponse from '../../common/sendHTTPResponse';
import logger from '../../config/logger';
import { MultiTenantConversationService } from '../../services/multiTenantConversation.service';
import { MultiTenantUserService } from '../../services/multiTenantUser.service';
import { AuthenticatedTenantRequest } from '../../middleware/tenant.middleware';

export const getUserConversationsRoute = async (req: AuthenticatedTenantRequest, res: Response) => {
    try {
        const tenantId = req.tenant!.tenantId;
        const userId = req.userId!;

        const conversations = await MultiTenantConversationService.getUserConversations(tenantId, userId);

        const responseData = {
            conversations: conversations,
            count: conversations.length
        };

        return sendHTTPResponse.success(res, 200, 'Conversations retrieved successfully', responseData);

    } catch (error: any) {
        logger.error('Get conversations error:', error);
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

export const getConversationMessagesRoute = async (req: AuthenticatedTenantRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const { page = '1', limit = '50' } = req.query;
        const tenantId = req.tenant!.tenantId;
        const userId = req.userId!;

        if (!conversationId) {
            return sendHTTPResponse.error(res, 400, 'Conversation ID is required');
        }

        // Validate conversation access
        const conversation = await MultiTenantConversationService.getConversationById(tenantId, conversationId, userId);
        if (!conversation) {
            return sendHTTPResponse.error(res, 404, 'Conversation not found or access denied');
        }

        const messages = await MultiTenantConversationService.getConversationMessages(
            tenantId,
            conversationId,
            userId,
            parseInt(page as string),
            parseInt(limit as string)
        );

        const responseData = {
            messages: messages,
            conversation_id: conversationId,
            page: parseInt(page as string),
            limit: parseInt(limit as string)
        };

        return sendHTTPResponse.success(res, 200, 'Messages retrieved successfully', responseData);

    } catch (error: any) {
        logger.error('Get messages error:', error);
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

export const sendMessageRoute = async (req: AuthenticatedTenantRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const { content, messageType = 'text' } = req.body;
        const tenantId = req.tenant!.tenantId;
        const userId = req.userId!;

        if (!conversationId) {
            return sendHTTPResponse.error(res, 400, 'Conversation ID is required');
        }

        // Validate input
        if (!content || typeof content !== 'string') {
            return sendHTTPResponse.error(res, 400, 'Message content is required');
        }

        // Validate conversation access
        const conversation = await MultiTenantConversationService.getConversationById(tenantId, conversationId, userId);
        if (!conversation) {
            return sendHTTPResponse.error(res, 404, 'Conversation not found or access denied');
        }

        // Send message
        const message = await MultiTenantConversationService.sendMessage(
            tenantId,
            conversationId,
            userId,
            content,
            messageType
        );

        const responseData = {
            message: {
                id: message.id,
                conversation_id: message.conversation_id,
                sender_id: message.sender_id,
                content: message.content,
                message_type: message.message_type,
                status: message.status,
                created_at: message.created_at
            }
        };

        logger.info(`Message sent: ${message.id} in conversation: ${conversationId} by user: ${userId} in tenant: ${tenantId}`);
        return sendHTTPResponse.success(res, 201, 'Message sent successfully', responseData);

    } catch (error: any) {
        logger.error('Send message error:', error);
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

export const markMessagesAsReadRoute = async (req: AuthenticatedTenantRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const tenantId = req.tenant!.tenantId;
        const userId = req.userId!;

        if (!conversationId) {
            return sendHTTPResponse.error(res, 400, 'Conversation ID is required');
        }

        // Validate conversation access
        const conversation = await MultiTenantConversationService.getConversationById(tenantId, conversationId, userId);
        if (!conversation) {
            return sendHTTPResponse.error(res, 404, 'Conversation not found or access denied');
        }

        // Mark messages as read
        await MultiTenantConversationService.markMessagesAsRead(tenantId, conversationId, userId);

        return sendHTTPResponse.success(res, 200, 'Messages marked as read');

    } catch (error: any) {
        logger.error('Mark messages as read error:', error);
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

export const startConversationRoute = async (req: AuthenticatedTenantRequest, res: Response) => {
    try {
        const { userEmail, initialMessage } = req.body;
        const tenantId = req.tenant!.tenantId;
        const userId = req.userId!;

        // Validate input
        if (!userEmail || typeof userEmail !== 'string') {
            return sendHTTPResponse.error(res, 400, 'User email is required');
        }

        // Start conversation with user
        const { conversation, targetUser } = await MultiTenantConversationService.startConversationWithUser(
            tenantId,
            userId,
            userEmail
        );

        let message = null;
        if (initialMessage && typeof initialMessage === 'string') {
            // Send initial message
            message = await MultiTenantConversationService.sendMessage(
                tenantId,
                conversation.id,
                userId,
                initialMessage
            );
        }

        const responseData = {
            conversation: {
                id: conversation.id,
                user1_id: conversation.user1_id,
                user2_id: conversation.user2_id,
                state: conversation.state,
                created_at: conversation.created_at
            },
            target_user: {
                id: targetUser.id,
                name: targetUser.name,
                email: targetUser.email
            },
            initial_message: message ? {
                id: message.id,
                content: message.content,
                created_at: message.created_at
            } : null
        };

        return sendHTTPResponse.success(res, 201, 'Conversation started successfully', responseData);

    } catch (error: any) {
        logger.error('Start conversation error:', error);
        if (error.message === 'User not found in this tenant') {
            return sendHTTPResponse.error(res, 404, error.message);
        }
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};

export const searchUsersRoute = async (req: AuthenticatedTenantRequest, res: Response) => {
    try {
        const { q: searchTerm } = req.query;
        const tenantId = req.tenant!.tenantId;
        const userId = req.userId!;

        // Validate input
        if (!searchTerm || typeof searchTerm !== 'string') {
            return sendHTTPResponse.error(res, 400, 'Search term is required');
        }

        if (searchTerm.length < 2) {
            return sendHTTPResponse.error(res, 400, 'Search term must be at least 2 characters');
        }

        // Search users in tenant
        const users = await MultiTenantUserService.searchUsers(tenantId, searchTerm, userId);

        const responseData = {
            users: users.map(user => ({
                id: user.id,
                name: user.name,
                email: user.email,
                is_online: user.is_online,
                last_seen: user.last_seen
            })),
            search_term: searchTerm,
            count: users.length
        };

        return sendHTTPResponse.success(res, 200, 'Users found', responseData);

    } catch (error: any) {
        logger.error('Search users error:', error);
        return sendHTTPResponse.error(res, 500, 'Internal server error');
    }
};
