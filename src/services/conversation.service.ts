import runQuery from '../database/runQuery';

export interface Conversation {
  id: string;
  user1_id: string;
  user2_id: string;
  state: 'open' | 'closed';
  last_message_at: Date;
  created_at: Date;
}

export interface ConversationWithUser {
  id: string;
  other_user_id: string;
  other_user_name: string;
  other_user_email: string;
  other_user_online: boolean;
  last_message_at: Date;
  last_message?: string;
  unread_count: number;
  state: 'open' | 'closed';
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: 'text' | 'image' | 'file';
  status: 'sent' | 'delivered' | 'read';
  created_at: Date;
  delivered_at?: Date;
  read_at?: Date;
}

export interface MessageWithSender {
  id: string;
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

export class ConversationService {
  // Find or create a conversation between two users
  static async findOrCreateConversation(user1Id: string, user2Id: string): Promise<Conversation> {
    // Ensure consistent ordering (smaller ID first)
    const [firstUserId, secondUserId] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];

    // Try to find existing conversation
    let query = `
      SELECT * FROM conversations 
      WHERE user1_id = $1 AND user2_id = $2
    `;
    let result = await runQuery(query, [firstUserId, secondUserId]);

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Create new conversation
    query = `
      INSERT INTO conversations (user1_id, user2_id)
      VALUES ($1, $2)
      RETURNING *
    `;
    result = await runQuery(query, [firstUserId, secondUserId]);
    return result.rows[0];
  }

  // Get all conversations for a user with enhanced info
  static async getUserConversations(userId: string): Promise<ConversationWithUser[]> {
    const query = `
      SELECT 
        c.id,
        c.state,
        c.last_message_at,
        CASE 
          WHEN c.user1_id = $1 THEN c.user2_id 
          ELSE c.user1_id 
        END as other_user_id,
        CASE 
          WHEN c.user1_id = $1 THEN u2.name 
          ELSE u1.name 
        END as other_user_name,
        CASE 
          WHEN c.user1_id = $1 THEN u2.email 
          ELSE u1.email 
        END as other_user_email,
        CASE 
          WHEN c.user1_id = $1 THEN u2.is_online 
          ELSE u1.is_online 
        END as other_user_online,
        lm.content as last_message,
        COALESCE(unread.unread_count, 0) as unread_count
      FROM conversations c
      JOIN users u1 ON c.user1_id = u1.id
      JOIN users u2 ON c.user2_id = u2.id
      LEFT JOIN LATERAL (
        SELECT content 
        FROM messages 
        WHERE conversation_id = c.id 
        ORDER BY created_at DESC 
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as unread_count
        FROM messages 
        WHERE conversation_id = c.id 
          AND sender_id != $1 
          AND status != 'read'
      ) unread ON true
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY c.last_message_at DESC
    `;

    const result = await runQuery(query, [userId]);
    return result.rows;
  }

  // Send a message in a conversation
  static async sendMessage(
    conversationId: string, 
    senderId: string, 
    content: string, 
    messageType: 'text' | 'image' | 'file' = 'text'
  ): Promise<Message> {
    const query = `
      INSERT INTO messages (conversation_id, sender_id, content, message_type, status)
      VALUES ($1, $2, $3, $4, 'sent')
      RETURNING *
    `;

    const result = await runQuery(query, [conversationId, senderId, content, messageType]);

    // Update conversation's last_message_at
    await runQuery(
      'UPDATE conversations SET last_message_at = NOW() WHERE id = $1',
      [conversationId]
    );

    return result.rows[0];
  }

  // Mark message as delivered
  static async markMessageDelivered(messageId: string): Promise<void> {
    const query = `
      UPDATE messages 
      SET status = 'delivered', delivered_at = NOW() 
      WHERE id = $1 AND status = 'sent'
    `;
    await runQuery(query, [messageId]);
  }

  // Mark messages as read
  static async markMessagesAsRead(conversationId: string, userId: string): Promise<void> {
    const query = `
      UPDATE messages 
      SET status = 'read', read_at = NOW() 
      WHERE conversation_id = $1 
        AND sender_id != $2 
        AND status != 'read'
    `;
    await runQuery(query, [conversationId, userId]);
  }

  // Get messages in a conversation with status
  static async getConversationMessages(
    conversationId: string, 
    userId: string, 
    page: number = 1, 
    limit: number = 50
  ): Promise<MessageWithSender[]> {
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        m.id,
        m.conversation_id,
        m.sender_id,
        u.name as sender_name,
        u.email as sender_email,
        m.content,
        m.message_type,
        m.status,
        m.created_at,
        m.delivered_at,
        m.read_at
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.conversation_id = $1 
        AND (c.user1_id = $2 OR c.user2_id = $2)
      ORDER BY m.created_at ASC
      LIMIT $3 OFFSET $4
    `;

    const result = await runQuery(query, [conversationId, userId, limit, offset]);
    
    // Auto-mark messages as delivered for the recipient
    await this.markUndeliveredMessages(conversationId, userId);
    
    return result.rows;
  }

  // Mark undelivered messages as delivered for a user
  private static async markUndeliveredMessages(conversationId: string, userId: string): Promise<void> {
    const query = `
      UPDATE messages 
      SET status = 'delivered', delivered_at = NOW() 
      WHERE conversation_id = $1 
        AND sender_id != $2 
        AND status = 'sent'
    `;
    await runQuery(query, [conversationId, userId]);
  }

  // Get conversation by ID (with permission check)
  static async getConversationById(conversationId: string, userId: string): Promise<Conversation | null> {
    const query = `
      SELECT * FROM conversations 
      WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)
    `;

    const result = await runQuery(query, [conversationId, userId]);
    return result.rows[0] || null;
  }

  // Start conversation with a user by email
  static async startConversationWithUser(currentUserId: string, targetUserEmail: string): Promise<{ conversation: Conversation; targetUser: any }> {
    // Find target user
    const userQuery = 'SELECT id, name, email, is_online FROM users WHERE email = $1';
    const userResult = await runQuery(userQuery, [targetUserEmail]);
    
    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const targetUser = userResult.rows[0];
    
    if (targetUser.id === currentUserId) {
      throw new Error('Cannot start conversation with yourself');
    }
    
    const conversation = await this.findOrCreateConversation(currentUserId, targetUser.id);

    return { conversation, targetUser };
  }

  // Close/Open conversation
  static async updateConversationState(conversationId: string, userId: string, state: 'open' | 'closed'): Promise<void> {
    const query = `
      UPDATE conversations 
      SET state = $1 
      WHERE id = $2 AND (user1_id = $3 OR user2_id = $3)
    `;
    await runQuery(query, [state, conversationId, userId]);
  }

  // Get unread message count for a user
  static async getUnreadCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE (c.user1_id = $1 OR c.user2_id = $1)
        AND m.sender_id != $1
        AND m.status != 'read'
    `;
    const result = await runQuery(query, [userId]);
    return parseInt(result.rows[0]?.count || '0');
  }
}
