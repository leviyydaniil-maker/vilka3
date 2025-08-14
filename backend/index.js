import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/test';
await mongoose.connect(uri);

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  passwordHash: String,
  allowed: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await User.create({ email, passwordHash: hash, allowed: true });
  res.sendStatus(201);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'invalid' });
  }
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, allowed: user.allowed });
});

app.get('/permissions', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(id);
    res.json({ allowed: !!user?.allowed });
  } catch {
    res.status(401).json({ allowed: false });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
