import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Contact from './models/Contact.js';
import Application from './models/Application.js';

// Get current directory for dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint for Cron-job to prevent Render sleep
app.get('/', (req, res) => res.status(200).send('API is running. Render server is awake!'));

// MongoDB Connection
const connectDB = async () => {
  try {
    // Disable Mongoose internal buffering to reduce memory footprint
    mongoose.set('bufferCommands', false);
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 5,          // Limit connection pool
      serverSelectionTimeoutMS: 5000,
    });
    console.log('MongoDB Connected Successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// API Routes
app.post('/api/contact', async (req, res) => {
  try {
    const { organization, email, type, message } = req.body;

    // Validate inputs
    if (!organization || !email || !type || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Create new contact submission
    const newContact = new Contact({
      organization,
      email,
      type,
      message
    });

    await newContact.save();
    
    console.log('New Contact Submission Saved!');
    res.status(201).json({ success: true, message: 'Partnership request submitted successfully!' });
  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

app.post('/api/careers', async (req, res) => {
  try {
    const data = req.body;

    const requiredFields = [
      'universityEmail', 'fullName', 'studentId', 'personalEmail', 'department', 'currentSemester',
      'teamType', 'firstPreference', 'secondPreference', 'whyDiganta', 'aspectsOfInterest',
      'skillsOrStrengths', 'relevantExperiences', 'hopeToLearn', 'cvFileUrl', 'cvFilename'
    ];

    for (const field of requiredFields) {
      if (!data[field]) {
        return res.status(400).json({ error: `Field ${field} is required` });
      }
    }

    const newApplication = new Application({
      ...data,
      softwareTools: data.softwareTools || [],
      comfortableTasks: data.comfortableTasks || [],
      completedCredits: data.completedCredits,
      technicalSkills: data.technicalSkills,
      cvFileUrl: data.cvFileUrl,
      cvFilename: data.cvFilename
    });

    await newApplication.save();
    
    console.log('New Recruitment Application Saved!');
    res.status(201).json({ success: true, message: 'Application submitted successfully!' });
  } catch (error) {
    console.error('Error saving application:', error);
    res.status(500).json({ error: 'Failed to process application' });
  }
});

// Route to view CV directly from MongoDB (For backward compatibility with old applications)
app.get('/api/careers/cv/:id', async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application || !application.cvFile || !application.cvFile.data) {
      return res.status(404).json({ error: 'CV not found' });
    }
    
    // Set headers so the browser displays the PDF natively instead of downloading it
    res.set('Content-Type', application.cvFile.contentType);
    res.set('Content-Disposition', `inline; filename="${application.cvFile.filename}"`);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(application.cvFile.data);
  } catch (error) {
    console.error('Error fetching CV:', error);
    res.status(500).json({ error: 'Failed to retrieve CV' });
  }
});

// Route to fetch all applications (for Admin panel)
app.get('/api/careers/applications', async (req, res) => {
  try {
    // Select all fields except cvFile.data to avoid downloading massive binary data
    const applications = await Application.find({}).select('-cvFile.data').sort({ createdAt: -1 });
    res.status(200).json({ success: true, applications });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: 'Failed to retrieve applications' });
  }
});

// Route to update a single application's recruitment status
app.patch('/api/careers/applications/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['applied', 'shortlisted', 'selected', 'rejected'];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const application = await Application.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, select: '-cvFile.data' }
    );

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    console.log(`Application ${req.params.id} status updated to: ${status}`);
    res.status(200).json({ success: true, application });
  } catch (error) {
    console.error('Error updating application status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Route to bulk-update multiple applications' recruitment status
app.patch('/api/careers/applications/bulk-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    const validStatuses = ['applied', 'shortlisted', 'selected', 'rejected'];

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await Application.updateMany(
      { _id: { $in: ids } },
      { status }
    );

    console.log(`Bulk status update: ${result.modifiedCount} applications updated to ${status}`);
    res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('Error in bulk status update:', error);
    res.status(500).json({ error: 'Failed to bulk update status' });
  }
});

// Start Server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
  });
});
