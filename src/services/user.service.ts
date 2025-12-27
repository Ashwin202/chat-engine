import runQuery from '../database/runQuery';
import bcrypt from 'bcrypt';

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  is_online: boolean;
  last_seen: Date;
  created_at: Date;
}

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
}

export class UserService {
  static async createUser(userData: CreateUserData): Promise<User> {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    
    const query = `
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await runQuery(query, [
      userData.name,
      userData.email,
      hashedPassword
    ]);

    return result.rows[0];
  }

  static async findUserByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await runQuery(query, [email]);
    return result.rows[0] || null;
  }

  static async findUserById(id: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await runQuery(query, [id]);
    return result.rows[0] || null;
  }

  static async verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  static async updateUserPassword(userId: string, newPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const query = `
      UPDATE users 
      SET password_hash = $1
      WHERE id = $2
    `;
    await runQuery(query, [hashedPassword, userId]);
  }

  static async updateOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    const query = `
      UPDATE users 
      SET is_online = $1, last_seen = NOW()
      WHERE id = $2
    `;
    await runQuery(query, [isOnline, userId]);
  }

  static async getOnlineUsers(): Promise<User[]> {
    const query = 'SELECT * FROM users WHERE is_online = TRUE';
    const result = await runQuery(query);
    return result.rows;
  }

  static async searchUsers(searchTerm: string, currentUserId: string): Promise<User[]> {
    const query = `
      SELECT id, name, email, is_online, last_seen
      FROM users 
      WHERE (name ILIKE $1 OR email ILIKE $1) 
        AND id != $2
      LIMIT 20
    `;
    const result = await runQuery(query, [`%${searchTerm}%`, currentUserId]);
    return result.rows;
  }
}
