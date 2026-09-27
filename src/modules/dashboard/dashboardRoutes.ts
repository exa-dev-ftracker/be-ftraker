import { Router } from "express";
import DashboardService from "./dashboardService";

const router = Router();

router.get("/dashboard", DashboardService.getDashboard);
router.get("/analytics", DashboardService.getAnalytics);

export default router;
