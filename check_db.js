const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Payment = require('./src/models/Payment');
const Subscription = require('./src/models/Subscription');
const Restaurant = require('./src/models/Restaurant');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const payments = await Payment.find().lean();
  console.log('--- PAYMENTS ---');
  payments.forEach(p => {
    console.log(`ID: ${p._id}, TargetType: ${p.targetType}, TargetId: ${p.targetId}, Amount: ${p.amount}, Status: ${p.status}, OrderCode: ${p.orderCode}, Metadata:`, p.metadata);
  });

  const subs = await Subscription.find().lean();
  console.log('--- SUBSCRIPTIONS ---');
  subs.forEach(s => {
    console.log(`ID: ${s._id}, OwnerId: ${s.ownerId}, RestaurantId: ${s.restaurantId}, PlanCode: ${s.planCode}, Status: ${s.status}, PeriodEnd: ${s.currentPeriodEnd}, PaymentId: ${s.paymentId}`);
  });

  const restaurants = await Restaurant.find().lean();
  console.log('--- RESTAURANTS ---');
  restaurants.forEach(r => {
    console.log(`ID: ${r._id}, OwnerId: ${r.ownerId}, Name: ${r.name}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
