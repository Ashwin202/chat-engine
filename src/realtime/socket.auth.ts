import { Socket } from 'socket.io';
import { JWTService } from '../common/jwt.service';
import { UserService } from '../services/user.service';
import logger from '../config/logger';

export const socketAuth = async (socket: Socket, next: any) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      logger.warn(`Socket connection rejected: No token provided`);
      return next(new Error('Authentication token is required'));
    }

    // Verify the token
    const decoded = JWTService.verifyAccessToken(token);
    if (!decoded) {
      logger.warn(`Socket connection rejected: Invalid token`);
      return next(new Error('Invalid authentication token'));
    }

    // Get user details
    const user = await UserService.findUserById(decoded.userId);
    if (!user) {
      logger.warn(`Socket connection rejected: User not found for ID ${decoded.userId}`);
      return next(new Error('User not found'));
    }

    // Attach user data to socket
    socket.data.user = {
      userId: user.id,
      email: user.email,
      // role: user.role,
      name: user.name
    };

    logger.info(`Socket authenticated for user ${user.email} (${user.id})`);
    next();
  } catch (error) {
    logger.error(error, 'Error during socket authentication:');
    next(new Error('Authentication failed'));
  }
};