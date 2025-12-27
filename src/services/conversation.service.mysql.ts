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
  state: 'open' | 'closed';
  last_message_at: Date;
  other_user_id: string;
  other_user_name: string;
  other_user_email: string;
  other_user_online: boolean;
  last_message: string | null;
  unread_count: number;
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
  static async findOrCreateConversation(user1Id: string, user2Id: string): Promise<Conversation | undefined> {
    // Ensure consistent ordering (smaller ID first)
    const [firstUserId, secondUserId] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];

    // Try to find existing conversation
    let query = `
      SELECT * FROM conversations 
      WHERE user1_id = ? AND user2_id = ?
    `;
    let result = await runQuery(query, [firstUserId, secondUserId]);

    if ((result.rows as Conversation[]).length > 0) {
      return (result.rows as Conversation[])[0];
    }

    // Create new conversation
    query = `
      INSERT INTO conversations (id, user1_id, user2_id)
      VALUES (UUID(), ?, ?)
    `;
    await runQuery(query, [firstUserId, secondUserId]);
    
    // Get the created conversation
    const selectQuery = `
      SELECT * FROM conversations 
      WHERE user1_id = ? AND user2_id = ?
      ORDER BY created_at DESC LIMIT 1
    `;
    result = await runQuery(selectQuery, [firstUserId, secondUserId]);
    const conversation = (result.rows as Conversation[])[0];
    if (!conversation) {
      throw new Error('Failed to create conversation');
    }
    return conversation;
  }

  // Get all conversations for a user with enhanced info
  static async getUserConversations(userId: string): Promise<ConversationWithUser[]> {
    const query = `
      SELECT 
        c.id,
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
         WHERE conversation_id = c.id 
         ORDER BY created_at DESC 
         LIMIT 1) as last_message,
        COALESCE((SELECT COUNT(*) 
                  FROM messages 
                  WHERE conversation_id = c.id 
                    AND sender_id != ? 
                    AND status != 'read'), 0) as unread_count
      FROM conversations c
      JOIN users u1 ON c.user1_id = u1.id
      JOIN users u2 ON c.user2_id = u2.id
      WHERE c.user1_id = ? OR c.user2_id = ?
      ORDER BY c.last_message_at DESC
    `;

    const result = await runQuery(query, [userId, userId, userId, userId, userId, userId, userId]);
    return result.rows as ConversationWithUser[];
  }

  // Send a message in a conversation
  static async sendMessage(conversationId: string, senderId: string, content: string, messageType: string = 'text'): Promise<Message> {
    const query = `
      INSERT INTO messages (id, conversation_id, sender_id, content, message_type, status)
      VALUES (UUID(), ?, ?, ?, ?, 'sent')
    `;

    await runQuery(query, [conversationId, senderId, content, messageType]);

    // Update conversation last_message_at
    await runQuery(
      'UPDATE conversations SET last_message_at = NOW() WHERE id = ?',
      [conversationId]
    );

    // Get the created message
    const selectQuery = `
      SELECT * FROM messages 
      WHERE conversation_id = ? AND sender_id = ? 
      ORDER BY created_at DESC LIMIT 1
    `;
    const result = await runQuery(selectQuery, [conversationId, senderId]);
    const message = (result.rows as Message[])[0];
    if (!message) {
      throw new Error('Failed to create message');
    }
    return message;
  }

  // Mark message as delivered
  static async markMessageAsDelivered(messageId: string): Promise<void> {
    const query = `
      UPDATE messages 
      SET status = 'delivered', delivered_at = NOW() 
      WHERE id = ? AND status = 'sent'
    `;
    await runQuery(query, [messageId]);
  }

  // Mark messages as read in a conversation
  static async markMessagesAsRead(conversationId: string, userId: string): Promise<void> {
    const query = `
      UPDATE messages 
      SET status = 'read', read_at = NOW() 
      WHERE conversation_id = ? AND sender_id != ? AND status IN ('sent', 'delivered')
    `;
    await runQuery(query, [conversationId, userId]);
  }

  // Get conversation messages with pagination
  static async getConversationMessages(
    conversationId: string, 
    userId: string, 
    page: number = 1, 
    limit: number = 50
  ): Promise<MessageWithSender[]> {
    // First verify user has access to this conversation
    const accessQuery = `
      SELECT id FROM conversations 
      WHERE id = ? AND (user1_id = ? OR user2_id = ?)
    `;
    const accessResult = await runQuery(accessQuery, [conversationId, userId, userId]);
    
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
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const result = await runQuery(query, [conversationId, limit, offset]);
    return result.rows as MessageWithSender[];
  }

  // Get conversation by ID and verify user access
  static async getConversationById(conversationId: string, userId: string): Promise<Conversation | null> {
    const query = `
      SELECT * FROM conversations 
      WHERE id = ? AND (user1_id = ? OR user2_id = ?)
    `;
    const result = await runQuery(query, [conversationId, userId, userId]);
    return (result.rows as Conversation[])[0] || null;
  }

  // Start conversation with a user by email
  static async startConversationWithUser(userId: string, userEmail: string): Promise<{ conversation: Conversation; targetUser: any }> {
    // Find the target user
    const userQuery = 'SELECT id, name, email FROM users WHERE email = ?';
    const userResult = await runQuery(userQuery, [userEmail]);
    
    if ((userResult.rows as any[]).length === 0) {
      throw new Error('User not found');
    }

    const targetUser = (userResult.rows as any[])[0];
    
    // Create or find conversation
    const conversation = await this.findOrCreateConversation(userId, targetUser.id);
    if (!conversation) {
      throw new Error('Failed to create or find conversation');
    }
    return { conversation, targetUser };
  }

  // Update conversation state
  static async updateConversationState(conversationId: string, userId: string, state: 'open' | 'closed'): Promise<void> {
    const query = `
      UPDATE conversations 
      SET state = ?
      WHERE id = ? AND (user1_id = ? OR user2_id = ?)
    `;
    await runQuery(query, [state, conversationId, userId, userId]);
  }

  // Get unread message count for a user
  static async getUnreadCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE (c.user1_id = ? OR c.user2_id = ?)
        AND m.sender_id != ?
        AND m.status != 'read'
    `;
    
    const result = await runQuery(query, [userId, userId, userId]);
    return parseInt((result.rows as any[])[0]?.count || '0');
  }
}
