import { Server, Socket } from 'socket.io';
import logger from '../config/logger';
import { ConversationService } from '../services/conversation.service';
import { UserService } from '../services/user.service';

export const registerSocketEvents = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    logger.info(`Socket connected: ${socket.id} for user ${user.name} (${user.userId})`);

    // Update user online status
    UserService.updateOnlineStatus(user.userId, true);

    // Join user to their personal room for notifications
    socket.join(`user:${user.userId}`);

    // Handle joining conversation rooms
    socket.on('join_conversation', async (conversationId: string) => {
      try {
        // Verify user has access to this conversation
        const conversation = await ConversationService.getConversationById(conversationId, user.userId);
        if (conversation) {
          socket.join(`conversation:${conversationId}`);
          logger.info(`User ${user.userId} joined conversation ${conversationId}`);
          
          // Notify others in conversation that user is online
          socket.to(`conversation:${conversationId}`).emit('user_online', {
            userId: user.userId,
            name: user.name
          });
        }
      } catch (error) {
        logger.error(error, 'Error joining conversation:');
      }
    });

    // Handle leaving conversation rooms
    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
      logger.info(`User ${user.userId} left conversation ${conversationId}`);
    });

    // Handle typing indicators
    socket.on('typing_start', ({ conversationId }: { conversationId: string }) => {
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId: user.userId,
        name: user.name,
        isTyping: true
      });
    });

    socket.on('typing_stop', ({ conversationId }: { conversationId: string }) => {
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId: user.userId,
        name: user.name,
        isTyping: false
      });
    });

    // Handle real-time message sending
    socket.on('send_message', async (data: {
      conversationId: string;
      content: string;
      messageType?: 'text' | 'image' | 'file';
    }) => {
      try {
        const { conversationId, content, messageType = 'text' } = data;

        // Verify user has access to conversation
        const conversation = await ConversationService.getConversationById(conversationId, user.userId);
        if (!conversation) {
          socket.emit('error', { message: 'Conversation not found' });
          return;
        }

        // Save message to database
        const message = await ConversationService.sendMessage(
          conversationId,
          user.userId,
          content,
          messageType
        );

        // Broadcast message to conversation participants
        const messageData = {
          id: message.id,
          conversationId: message.conversation_id,
          senderId: message.sender_id,
          senderName: user.name,
          content: message.content,
          messageType: message.message_type,
          status: message.status,
          createdAt: message.created_at
        };

        // Send to conversation room
        io.to(`conversation:${conversationId}`).emit('new_message', messageData);

        // Send acknowledgment to sender
        socket.emit('message_sent', { messageId: message.id, status: 'sent' });

        // Mark message as delivered for online users
        setTimeout(async () => {
          await ConversationService.markMessageDelivered(message.id);
          io.to(`conversation:${conversationId}`).emit('message_status_update', {
            messageId: message.id,
            status: 'delivered'
          });
        }, 100);

      } catch (error) {
        logger.error(error, 'Error sending message:');
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle message read receipts
    socket.on('mark_messages_read', async ({ conversationId }: { conversationId: string }) => {
      try {
        await ConversationService.markMessagesAsRead(conversationId, user.userId);
        
        // Notify other participants
        socket.to(`conversation:${conversationId}`).emit('messages_read', {
          userId: user.userId,
          conversationId
        });
      } catch (error) {
        logger.error(error, 'Error marking messages as read:');
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${socket.id} for user ${user.name}`);
      
      // Update user offline status
      await UserService.updateOnlineStatus(user.userId, false);

      // Notify all conversation participants that user is offline
      const userRooms = Array.from(socket.rooms).filter(room => room.startsWith('conversation:'));
      userRooms.forEach(room => {
        socket.to(room).emit('user_offline', {
          userId: user.userId,
          name: user.name
        });
      });
    });
  });
};
