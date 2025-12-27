import express, { Request, Response} from 'express';
import http from 'http';
import path from 'path';
import conversationsRouter from './routes/conversations/index';
import authRouter from './routes/auth/index';
import { authenticateToken } from './middleware/auth.middleware';
import './config/database';
import { initRealtime } from './realtime';
import { TokenCleanupService } from './services/tokenCleanup.service';
import logger from './config/logger';
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());

// CORS middleware for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/auth', authRouter);
app.use('/api/conversations', conversationsRouter);

app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

// Serve frontend for any non-API routes
app.get('/frontend', (req: Request, res: Response) => {
  if (!req.path.startsWith('/auth') && !req.path.startsWith('/conversations') && !req.path.startsWith('/health')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO and real-time features
initRealtime(server);

// Start token cleanup service
TokenCleanupService.startCleanup();

// Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
});

export {app};