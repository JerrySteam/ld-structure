const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { Queue } = require('bullmq');
const fs = require("fs");
const LDSController = require('../controllers/ldStructureModule');
const config = require('./config');

// if (!fs.existsSync('/tmp/summaryStats')) {
//   fs.mkdirSync('/tmp/summaryStats', { recursive: true });
// }
// const upload = multer({ dest: '/tmp/summaryStats/' });

// ========================================================================
// Create job unique id 
let jobUniqueID = '';
const queue = new Queue(config.queueName, {
  connection: config.connection,
  // limiter: { groupKey: config.limiter.groupKey },
});

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    jobUniqueID = uuidv4();
    let outputDir = await LDSController.createJobDir(jobUniqueID);
    cb(null, outputDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix)
  }
})

const upload = multer({ storage: storage })
// ========================================================================

router.post('/jobs', authenticateToken, upload.single('file'), async (req, res) => {
  // Validate input file
  if (!await LDSController.isFileValid(req.file)) return res.status(400).send('Please upload a valid file');

  // Validate other form data
  const { error } = await LDSController.validateFormData(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  // Save job parameters to DB
  const jobResult = await LDSController.saveJobsToDB(req, jobUniqueID);
  if (jobResult.errors) return res.status(400).send(jobResult.message);

  // Add job to the queue
  await queue.add(req.body.job_name, {
    jobUniqueID: jobUniqueID,
    filepath: req.file.path,
    marker_name: req.body.marker_name, 
    r_squared: req.body.r_squared,
    outputDir: req.file.destination
  });

  return res.status(200).json(jobUniqueID);
});

router.get('/jobs', authenticateToken, async (req, res) => {
  const result = await LDSController.getAllJobsFromDB();
  if (result.errors) return res.status(400).send(result.message);
  res.send(result.filter(job => job.username === req.user.username));
})

router.get('/jobs/:jobUniqueID', authenticateToken, async (req, res) => {
  let result = await LDSController.getJobFromDB(req.params.jobUniqueID);
  if (result.errors) return res.status(400).send(result.message);

  result = result.filter(job => job.username === req.user.username)
  
  const fewOutput = await LDSController.readFewProcessedFile(result[0].outputFilepath);
  if (fewOutput.errors) return res.status(400).send(fewOutput.message);
  res.send(fewOutput);
})

router.delete('/jobs', authenticateToken, async (req, res) => {
  const result = await LDSController.deleteAllJobsFromDB();
  if (result.errors) return res.status(400).send(result.message);
  // console.log(result);
  res.send(result.filter(job => job.username === req.user.username));
})

router.delete('/jobs/:jobUniqueID', authenticateToken, async (req, res) => {
  // Detele job from db
  const result = await LDSController.deleteJobFromDB(req.params.jobUniqueID);
  if (result.errors) return res.status(400).send(result.message);

  // delete job directory
  await LDSController.deleteJobDir(req.params.jobUniqueID);

  // get and return all jobs
  const resultAllJobs = await LDSController.getAllJobsFromDB();
  if (resultAllJobs.errors) return res.status(400).send(resultAllJobs.message);
  res.send(resultAllJobs.filter(job => job.username === req.user.username));
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (token == null) return res.sendStatus(401)

  const jwt_decode = require('jwt-decode');
  req.user = jwt_decode(token);
  // console.log(req.user)
  next()

  // jwt.verify(token, process.env.JWT_KEY, (err, user) => {
  //   console.log(err)
  //   if (err) return res.sendStatus(403)
  //   req.user = user
  //   next() 
  // })
}

module.exports = router;