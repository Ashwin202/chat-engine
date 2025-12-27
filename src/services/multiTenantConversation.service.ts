import runQuery from '../database/runQuery';
import { MultiTenantConversation, MultiTenantMessage } from '../types/tenant.types';

export interface ConversationWithUser {
  id: string;
  tenant_id: string;
  state: 'open' | 'closed';
  last_message_at: Date;
  other_user_id: string;
  other_user_name: string;
  other_user_email: string;
  other_user_online: boolean;
  last_message: string | null;
  unread_count: number;
}

export interface MessageWithSender {
  id: string;
  tenant_id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_email: string;
  content: string;
  message_type: 'text' | 'image' | 'file';
  status: 'sent' | 'delivered' | 'read';
  created_at: Date;
  delivered_at?: Date;
  read_at?: Date;
}

export class MultiTenantConversationService {
  // Find or create a conversation between two users within a tenant
  static async findOrCreateConversation(tenantId: string, user1Id: string, user2Id: string): Promise<MultiTenantConversation> {
    // Ensure consistent ordering (smaller ID first)
    const [firstUserId, secondUserId] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];

    // Try to find existing conversation - TENANT BARRIER
    let query = `
      SELECT * FROM conversations 
      WHERE tenant_id = ? AND user1_id = ? AND user2_id = ?
    `;
    let result = await runQuery(query, [tenantId, firstUserId, secondUserId]);

    if ((result.rows as MultiTenantConversation[]).length > 0) {
      const conversation = (result.rows as MultiTenantConversation[])[0];
      if (!conversation) {
        throw new Error('Failed to find conversation');
      }
      return conversation;
    }

    // Create new conversation - TENANT BARRIER
    query = `
      INSERT INTO conversations (id, tenant_id, user1_id, user2_id)
      VALUES (UUID(), ?, ?, ?)
    `;
    await runQuery(query, [tenantId, firstUserId, secondUserId]);
    
    // Get the created conversation - TENANT BARRIER
    const selectQuery = `
      SELECT * FROM conversations 
      WHERE tenant_id = ? AND user1_id = ? AND user2_id = ?
      ORDER BY created_at DESC LIMIT 1
    `;
    result = await runQuery(selectQuery, [tenantId, firstUserId, secondUserId]);
    const conversation = (result.rows as MultiTenantConversation[])[0];
    if (!conversation) {
      throw new Error('Failed to create conversation');
    }
    return conversation;
  }

  // Get all conversations for a user with enhanced info - TENANT BARRIER
  static async getUserConversations(tenantId: string, userId: string): Promise<ConversationWithUser[]> {
    const query = `
      SELECT 
        c.id,
        c.tenant_id,
        c.state,
        c.last_message_at,
        CASE 
          WHEN c.user1_id = ? THEN c.user2_id 
          ELSE c.user1_id 
        END as other_user_id,
        CASE 
          WHEN c.user1_id = ? THEN u2.name 
          ELSE u1.name 
        END as other_user_name,
        CASE 
          WHEN c.user1_id = ? THEN u2.email 
          ELSE u1.email 
        END as other_user_email,
        CASE 
          WHEN c.user1_id = ? THEN u2.is_online 
          ELSE u1.is_online 
        END as other_user_online,
        (SELECT content 
         FROM messages 
         WHERE tenant_id = ? AND conversation_id = c.id 
         ORDER BY created_at DESC 
         LIMIT 1) as last_message,
        COALESCE((SELECT COUNT(*) 
                  FROM messages 
                  WHERE tenant_id = ? AND conversation_id = c.id 
                    AND sender_id != ? 
                    AND status != 'read'), 0) as unread_count
      FROM conversations c
      JOIN users u1 ON c.tenant_id = u1.tenant_id AND c.user1_id = u1.id
      JOIN users u2 ON c.tenant_id = u2.tenant_id AND c.user2_id = u2.id
      WHERE c.tenant_id = ? AND (c.user1_id = ? OR c.user2_id = ?)
      ORDER BY c.last_message_at DESC
    `;

    const result = await runQuery(query, [
      userId, userId, userId, userId, // CASE statements
      tenantId, tenantId, userId,      // Subqueries
      tenantId, userId, userId         // WHERE clause
    ]);
    return result.rows as ConversationWithUser[];
  }

  // Send a message in a conversation - TENANT BARRIER
  static async sendMessage(
    tenantId: string, 
    conversationId: string, 
    senderId: string, 
    content: string, 
    messageType: string = 'text'
  ): Promise<MultiTenantMessage> {
    const query = `
      INSERT INTO messages (id, tenant_id, conversation_id, sender_id, content, message_type, status)
      VALUES (UUID(), ?, ?, ?, ?, ?, 'sent')
    `;

    await runQuery(query, [tenantId, conversationId, senderId, content, messageType]);

    // Update conversation last_message_at - TENANT BARRIER
    await runQuery(
      'UPDATE conversations SET last_message_at = NOW() WHERE tenant_id = ? AND id = ?',
      [tenantId, conversationId]
    );

    // Get the created message - TENANT BARRIER
    const selectQuery = `
      SELECT * FROM messages 
      WHERE tenant_id = ? AND conversation_id = ? AND sender_id = ? 
      ORDER BY created_at DESC LIMIT 1
    `;
    const result = await runQuery(selectQuery, [tenantId, conversationId, senderId]);
    const message = (result.rows as MultiTenantMessage[])[0];
    if (!message) {
      throw new Error('Failed to create message');
    }
    return message;
  }

  // Mark message as delivered - TENANT BARRIER
  static async markMessageAsDelivered(tenantId: string, messageId: string): Promise<void> {
    const query = `
      UPDATE messages 
      SET status = 'delivered', delivered_at = NOW() 
      WHERE tenant_id = ? AND id = ? AND status = 'sent'
    `;
    await runQuery(query, [tenantId, messageId]);
  }

  // Mark messages as read in a conversation - TENANT BARRIER
  static async markMessagesAsRead(tenantId: string, conversationId: string, userId: string): Promise<void> {
    const query = `
      UPDATE messages 
      SET status = 'read', read_at = NOW() 
      WHERE tenant_id = ? AND conversation_id = ? AND sender_id != ? AND status IN ('sent', 'delivered')
    `;
    await runQuery(query, [tenantId, conversationId, userId]);
  }

  // Get conversation messages with pagination - TENANT BARRIER
  static async getConversationMessages(
    tenantId: string,
    conversationId: string, 
    userId: string, 
    page: number = 1, 
    limit: number = 50
  ): Promise<MessageWithSender[]> {
    // First verify user has access to this conversation - TENANT BARRIER
    const accessQuery = `
      SELECT id FROM conversations 
      WHERE tenant_id = ? AND id = ? AND (user1_id = ? OR user2_id = ?)
    `;
    const accessResult = await runQuery(accessQuery, [tenantId, conversationId, userId, userId]);
    
    if ((accessResult.rows as any[]).length === 0) {
      throw new Error('Access denied to this conversation');
    }

    const offset = (page - 1) * limit;
    const query = `
      SELECT 
        m.*,
        u.name as sender_name,
        u.email as sender_email
      FROM messages m
      JOIN users u ON m.tenant_id = u.tenant_id AND m.sender_id = u.id
      WHERE m.tenant_id = ? AND m.conversation_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const result = await runQuery(query, [tenantId, conversationId, limit, offset]);
    return result.rows as MessageWithSender[];
  }

  // Get conversation by ID and verify user access - TENANT BARRIER
  static async getConversationById(tenantId: string, conversationId: string, userId: string): Promise<MultiTenantConversation | null> {
    const query = `
      SELECT * FROM conversations 
      WHERE tenant_id = ? AND id = ? AND (user1_id = ? OR user2_id = ?)
    `;
    const result = await runQuery(query, [tenantId, conversationId, userId, userId]);
    return (result.rows as MultiTenantConversation[])[0] || null;
  }

  // Start conversation with a user by email - TENANT BARRIER
  static async startConversationWithUser(
    tenantId: string, 
    userId: string, 
    userEmail: string
  ): Promise<{ conversation: MultiTenantConversation; targetUser: any }> {
    // Find the target user - TENANT BARRIER
    const userQuery = 'SELECT id, name, email FROM users WHERE tenant_id = ? AND email = ?';
    const userResult = await runQuery(userQuery, [tenantId, userEmail]);
    
    if ((userResult.rows as any[]).length === 0) {
      throw new Error('User not found in this tenant');
    }

    const targetUser = (userResult.rows as any[])[0];
    
    // Create or find conversation - TENANT BARRIER
    const conversation = await this.findOrCreateConversation(tenantId, userId, targetUser.id);
    
    return { conversation, targetUser };
  }

  // Update conversation state - TENANT BARRIER
  static async updateConversationState(
    tenantId: string, 
    conversationId: string, 
    userId: string, 
    state: 'open' | 'closed'
  ): Promise<void> {
    const query = `
      UPDATE conversations 
      SET state = ?
      WHERE tenant_id = ? AND id = ? AND (user1_id = ? OR user2_id = ?)
    `;
    await runQuery(query, [state, tenantId, conversationId, userId, userId]);
  }

  // Get unread message count for a user - TENANT BARRIER
  static async getUnreadCount(tenantId: string, userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM messages m
      JOIN conversations c ON m.tenant_id = c.tenant_id AND m.conversation_id = c.id
      WHERE m.tenant_id = ? AND (c.user1_id = ? OR c.user2_id = ?)
        AND m.sender_id != ?
        AND m.status != 'read'
    `;
    
    const result = await runQuery(query, [tenantId, userId, userId, userId]);
    return parseInt((result.rows as any[])[0]?.count || '0');
  }

  // Get tenant conversation statistics
  static async getTenantConversationStats(tenantId: string): Promise<{
    totalConversations: number;
    totalMessages: number;
    activeConversations: number;
  }> {
    const conversationsQuery = 'SELECT COUNT(*) as count FROM conversations WHERE tenant_id = ?';
    const messagesQuery = 'SELECT COUNT(*) as count FROM messages WHERE tenant_id = ?';
    const activeQuery = `
      SELECT COUNT(*) as count FROM conversations 
      WHERE tenant_id = ? AND state = 'open' 
      AND last_message_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const [convResult, msgResult, activeResult] = await Promise.all([
      runQuery(conversationsQuery, [tenantId]),
      runQuery(messagesQuery, [tenantId]),
      runQuery(activeQuery, [tenantId])
    ]);

    return {
      totalConversations: parseInt((convResult.rows as any[])[0]?.count || '0'),
      totalMessages: parseInt((msgResult.rows as any[])[0]?.count || '0'),
      activeConversations: parseInt((activeResult.rows as any[])[0]?.count || '0')
    };
  }
}
