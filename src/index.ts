import express, { Request, Response} from 'express';
import conversationsRouter from './routes/conversations/index';
require('dotenv').config();

const app = express();
app.use(express.json());

app.use('/conversations', conversationsRouter);

app.get('/health', (req: Request, res: Response) => {
  res.send('OK');
});

export {app};