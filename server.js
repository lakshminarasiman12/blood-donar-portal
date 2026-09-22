const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database
const db = new Database('blood_portal.db');
db.pragma('journal_mode = WAL');

// 1. Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS donors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    blood_group TEXT CHECK(blood_group IN ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')) NOT NULL,
    city_area TEXT NOT NULL,
    phone TEXT NOT NULL,
    is_available INTEGER DEFAULT 1 CHECK(is_available IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_name TEXT NOT NULL,
    hospital_name TEXT NOT NULL,
    city_area TEXT NOT NULL,
    blood_group TEXT CHECK(blood_group IN ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')) NOT NULL,
    units_needed INTEGER DEFAULT 1 CHECK(units_needed > 0),
    contact_phone TEXT NOT NULL,
    urgency_level TEXT CHECK(urgency_level IN ('Critical', 'Urgent', 'Standard')) DEFAULT 'Urgent',
    status TEXT CHECK(status IN ('Open', 'Donor In Transit', 'Fulfilled', 'Cancelled')) DEFAULT 'Open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 2. Seed Initial Data if empty
const donorCount = db.prepare('SELECT COUNT(*) as count FROM donors').get().count;
if (donorCount === 0) {
  const insertDonor = db.prepare(
    'INSERT INTO donors (name, blood_group, city_area, phone, is_available) VALUES (?, ?, ?, ?, ?)'
  );
  insertDonor.run('Rahul Sharma', 'O+', 'Central Area', '9876543210', 1);
  insertDonor.run('Priya Nair', 'A+', 'North Zone', '9876543211', 1);
  insertDonor.run('Anil Kumar', 'B+', 'South Ward', '9876543212', 0);
  insertDonor.run('Sara Khan', 'AB-', 'East Gate', '9876543213', 1);
  insertDonor.run('David Miller', 'O-', 'Central Area', '9876543214', 1);
}

const reqCount = db.prepare('SELECT COUNT(*) as count FROM requests').get().count;
if (reqCount === 0) {
  const insertReq = db.prepare(
    'INSERT INTO requests (patient_name, hospital_name, city_area, blood_group, units_needed, contact_phone, urgency_level, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertReq.run('Sunil Verma', 'City Care Hospital', 'Central Area', 'O+', 2, '9123456780', 'Critical', 'Open');
  insertReq.run('Meera Raj', 'Apollo Clinic', 'North Zone', 'A+', 1, '9123456781', 'Urgent', 'Donor In Transit');
  insertReq.run('John Doe', 'General Hospital', 'South Ward', 'B+', 3, '9123456782', 'Standard', 'Fulfilled');
}

// ---------------- API ROUTES ----------------

// Active Stats Endpoint
app.get('/api/stats', (req, res) => {
  try {
    const activeRequests = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'Open'").get().count;
    const registeredDonors = db.prepare("SELECT COUNT(*) as count FROM donors WHERE is_available = 1").get().count;
    const fulfilledRequests = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'Fulfilled'").get().count;

    res.json({
      activeRequests,
      registeredDonors,
      fulfilledRequests
    });
  } catch (err) {
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Get Requests with filters
app.get('/api/requests', (req, res) => {
  const { blood_group, status, city_area } = req.query;
  let query = 'SELECT * FROM requests WHERE 1=1';
  const params = [];

  if (blood_group) {
    query += ' AND blood_group = ?';
    params.push(blood_group);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (city_area) {
    query += ' AND city_area LIKE ?';
    params.push(`%${city_area}%`);
  }

  query += ' ORDER BY created_at DESC';
  const data = db.prepare(query).all(...params);
  res.json(data);
});

// Create Request
app.post('/api/requests', (req, res) => {
  const { patient_name, hospital_name, city_area, blood_group, units_needed, contact_phone, urgency_level } = req.body;
  if (!patient_name || !hospital_name || !blood_group || !contact_phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const stmt = db.prepare(`
    INSERT INTO requests (patient_name, hospital_name, city_area, blood_group, units_needed, contact_phone, urgency_level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(patient_name, hospital_name, city_area || 'Not specified', blood_group, units_needed || 1, contact_phone, urgency_level || 'Urgent');
  res.status(201).json({ id: info.lastInsertRowid, ...req.body });
});

// Update Request Status
app.patch('/api/requests/:id/status', (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  const valid = ['Open', 'Donor In Transit', 'Fulfilled', 'Cancelled'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const stmt = db.prepare('UPDATE requests SET status = ? WHERE id = ?');
  const result = stmt.run(status, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, id, status });
});

// Get Donors with filters
app.get('/api/donors', (req, res) => {
  const { blood_group, city_area } = req.query;
  let query = 'SELECT * FROM donors WHERE 1=1';
  const params = [];

  if (blood_group) {
    query += ' AND blood_group = ?';
    params.push(blood_group);
  }
  if (city_area) {
    query += ' AND city_area LIKE ?';
    params.push(`%${city_area}%`);
  }

  const data = db.prepare(query).all(...params);
  res.json(data);
});

// Register Donor
app.post('/api/donors', (req, res) => {
  const { name, blood_group, city_area, phone } = req.body;
  if (!name || !blood_group || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const stmt = db.prepare('INSERT INTO donors (name, blood_group, city_area, phone) VALUES (?, ?, ?, ?)');
  const info = stmt.run(name, blood_group, city_area || 'General Area', phone);
  res.status(201).json({ id: info.lastInsertRowid, ...req.body });
});

// Toggle Donor Availability
app.patch('/api/donors/:id/toggle', (req, res) => {
  const { id } = req.params;
  const donor = db.prepare('SELECT is_available FROM donors WHERE id = ?').get(id);
  if (!donor) return res.status(404).json({ error: 'Donor not found' });

  const newStatus = donor.is_available === 1 ? 0 : 1;
  db.prepare('UPDATE donors SET is_available = ? WHERE id = ?').run(newStatus, id);
  res.json({ success: true, id, is_available: newStatus });
});

// Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server live at http://localhost:${PORT}`);
  console.log(`Stats endpoint active at http://localhost:${PORT}/api/stats`);
});