// index.ts
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app: Express = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// --- ОСНОВНОЙ МАРШРУТ ---
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({ message: "Добро пожаловать на API Aralchi!" });
});

// --- МАРШРУТЫ АУТЕНТИФИКАЦИИ ---

// Регистрация нового пользователя
app.post("/api/auth/register", async (req: Request, res: Response) => {
  const { email, password, categoryIds } = req.body;
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return res
      .status(400)
      .json({ error: "Пользователь с таким email уже существует." });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      categories: {
        connect: categoryIds?.map((id: number) => ({ id })) || [],
      },
    },
  });
  res
    .status(201)
    .json({ message: "Пользователь успешно создан!", userId: user.id });
});

// Вход пользователя
app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Неверный email или пароль." });
  }
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ error: "Неверный email или пароль." });
  }
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET as string,
    { expiresIn: "24h" }
  );
  res.json({ token, userId: user.id, message: "Вход выполнен успешно!" });
});

// --- MIDDLEWARE ДЛЯ ПРОВЕРКИ JWT ТОКЕНА ---

interface AuthRequest extends Request {
  user?: { userId: number };
}

const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET as string, (err: any, user: any) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

app.get("/api/users", async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      // Выбираем только те поля, которые безопасно отдавать на фронтенд
      select: {
        id: true,
        email: true,
        createdAt: true,
        categories: true, // Включаем категории, которые выбрал пользователь
      },
    });
    res.json(users);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Не удалось получить список пользователей." });
  }
});

// --- ЗАЩИЩЁННЫЙ МАРШРУТ ДЛЯ ПРОФИЛЯ ---

app.get(
  "/api/profile",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res
          .status(400)
          .json({ error: "ID пользователя не найден в токене." });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          createdAt: true,
          categories: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: "Пользователь не найден." });
      }

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Внутренняя ошибка сервера." });
    }
  }
);

app.post(
  "/api/profile/categories",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.userId;
      const { categoryIds } = req.body;

      if (!userId) {
        return res
          .status(400)
          .json({ error: "ID пользователя не найден в токене." });
      }
      if (!Array.isArray(categoryIds)) {
        return res
          .status(400)
          .json({ error: "categoryIds должен быть массивом." });
      }

      // Обновляем пользователя, устанавливая ему новые категории
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          // 'set' перезаписывает все старые связи новыми
          categories: {
            set: categoryIds.map((id: number) => ({ id: id })),
          },
        },
        include: {
          categories: true, // Возвращаем обновленного пользователя с категориями
        },
      });

      res.json(updatedUser);
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ error: "Не удалось обновить категории пользователя." });
    }
  }
);

// --- МАРШРУТЫ ДЛЯ КАТЕГОРИЙ ---

app.get("/api/categories", async (req: Request, res: Response) => {
  const categories = await prisma.category.findMany();
  res.json(categories);
});

app.post("/api/categories", async (req: Request, res: Response) => {
  const { name } = req.body;
  try {
    const newCategory = await prisma.category.create({ data: { name } });
    res.status(201).json(newCategory);
  } catch (error) {
    res.status(400).json({ error: "Категория с таким именем уже существует." });
  }
});

app.delete("/api/categories/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.category.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({
      error:
        "Не удалось удалить категорию. Убедитесь, что она существует и не используется.",
    });
  }
});

// --- МАРШРУТЫ ДЛЯ ЗАДАЧ ---

app.get("/api/tasks", async (req: Request, res: Response) => {
  const tasks = await prisma.task.findMany({ include: { categories: true } });
  res.json(tasks);
});

app.post("/api/tasks", async (req: Request, res: Response) => {
  const { title, categoryIds } = req.body;
  if (!Array.isArray(categoryIds)) {
    return res.status(400).json({ error: "categoryIds должен быть массивом." });
  }
  try {
    const newTask = await prisma.task.create({
      data: {
        title,
        categories: { connect: categoryIds.map((id: number) => ({ id })) },
      },
      include: { categories: true },
    });
    res.status(201).json(newTask);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Не удалось создать задачу. Проверьте ID категорий." });
  }
});

app.delete("/api/tasks/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.task.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({ error: "Задача не найдена." });
  }
});

// --- ЗАПУСК СЕРВЕРА ---
app.listen(PORT, () => {
  console.log(`🚀 Сервер успешно запущен на порту ${PORT}`);
});
