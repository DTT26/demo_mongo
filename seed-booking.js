require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Restaurant = require('./src/models/Restaurant');
const Booking = require('./src/models/Booking');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    const customer = await User.findOne({ email: 'customer123@example.com' });
    if (!customer) throw new Error('Customer not found');

    const owner = await User.findOne({ email: 'owner123@example.com' });
    if (!owner) throw new Error('Owner not found');

    const restaurant = await Restaurant.findOne({ ownerId: owner._id });
    if (!restaurant) throw new Error('Restaurant not found');

    // Remove old test bookings for this customer & restaurant if needed
    // await Booking.deleteMany({ customerId: customer._id, restaurantId: restaurant._id });

    // Past date so it can be completed
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);

    const booking = new Booking({
      customerId: customer._id,
      restaurantId: restaurant._id,
      bookingDate: pastDate,
      bookingTime: '19:00',
      numberOfGuests: 2,
      customerName: customer.fullName,
      customerPhone: customer.phone || '0123456789',
      customerEmail: customer.email,
      status: 'completed',
      reviewed: false,
      completedAt: new Date(),
    });

    await booking.save();
    console.log('Booking seeded successfully! Booking ID:', booking._id);

  } catch (error) {
    console.error('Error seeding booking:', error);
  } finally {
    mongoose.disconnect();
  }
}

seed();
