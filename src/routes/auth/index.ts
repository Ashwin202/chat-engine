import { Router } from 'express';
import { 
    registerUserRoute, 
    loginRoute, 
    refreshTokenRoute, 
    logoutRoute, 
    logoutAllRoute, 
    getMeRoute,
    changePasswordRoute
} from './controller';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

// Public routes
router.post('/register', registerUserRoute);
router.post('/login', loginRoute);
router.post('/refresh', refreshTokenRoute);

// Protected routes
router.post('/logout', authenticateToken, logoutRoute);
router.post('/logout-all', authenticateToken, logoutAllRoute);
router.get('/me', authenticateToken, getMeRoute);
router.put('/change-password', authenticateToken, changePasswordRoute);

export default router;
