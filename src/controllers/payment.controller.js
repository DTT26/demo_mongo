// ─────────────────────────────────────────────
// Payment Controller
// ─────────────────────────────────────────────
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Booking = require('../models/Booking');
const Subscription = require('../models/Subscription');
const Restaurant = require('../models/Restaurant');
const payosService = require('../services/payos.service');
const { SUBSCRIPTION_PLANS } = require('../config/payos.config');

// ─── Tạo mã orderCode duy nhất ───
const generateOrderCode = async () => {
  // Sử dụng timestamp kết hợp random để đảm bảo duy nhất và là số nguyên dương
  let orderCode;
  let exists = true;
  while (exists) {
    orderCode = Math.floor(Date.now() / 1000) * 100 + Math.floor(Math.random() * 100);
    // PayOS orderCode phải nằm trong khoảng 1 - 9007199254740991
    if (orderCode > 9007199254740991) {
      orderCode = Math.floor(Math.random() * 9007199254740991) + 1;
    }
    const found = await Payment.findOne({ orderCode });
    if (!found) exists = false;
  }
  return orderCode;
};

// ─── POST /api/v1/payments/create ───
exports.createPayment = async (req, res) => {
  try {
    const { targetType, targetId } = req.body;
    const userId = req.user._id;

    if (!targetType || !targetId) {
      return res.status(400).json({ success: false, message: 'targetType và targetId là bắt buộc.' });
    }

    let amount = 0;
    let description = '';
    let restaurantId = null;
    let metadata = {};

    // ─── Tính tiền theo loại ───
    if (targetType === 'booking') {
      const booking = await Booking.findById(targetId).populate('restaurantId');
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking không tồn tại.' });
      }
      if (booking.customerId.toString() !== userId.toString()) {
        return res.status(403).json({ success: false, message: 'Bạn không có quyền thanh toán booking này.' });
      }
      if (booking.depositPaid) {
        return res.status(400).json({ success: false, message: 'Booking này đã được thanh toán đặt cọc.' });
      }
      amount = (booking.depositAmount || 0) - (booking.discountAmount || 0);
      amount = Math.max(0, amount);
      if (amount <= 0) {
        // Miễn cọc do giảm giá voucher lớn hơn hoặc bằng tiền cọc
        booking.depositPaid = true;
        booking.depositPaidAt = new Date();
        booking.status = 'confirmed';
        booking.statusHistory.push({
          status: 'confirmed',
          changedAt: new Date(),
          note: 'Áp dụng mã giảm giá, miễn cọc hoàn toàn',
        });
        await booking.save();

        if (booking.voucherId) {
          try {
            const voucherService = require('../services/voucher.service');
            await voucherService.redeemVoucher(
              booking.voucherId.code,
              booking.restaurantId?._id || booking.restaurantId,
              booking.customerId,
              booking.depositAmount,
              booking._id,
              null
            );
          } catch (e) {
            console.error('Lỗi redeem voucher miễn cọc:', e.message);
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Đặt cọc đã được xác nhận miễn phí nhờ mã giảm giá.',
          data: {
            status: 'paid',
            amount: 0,
            bookingId: booking._id,
          }
        });
      }
      description = `Đặt cọc bàn #${booking._id.toString().slice(-6).toUpperCase()}`;
      restaurantId = booking.restaurantId?._id || booking.restaurantId;
      metadata = { bookingDate: booking.bookingDate, numberOfGuests: booking.numberOfGuests };

    } else if (targetType === 'subscription') {
      // targetId ở đây là restaurantId
      const restaurant = await Restaurant.findById(targetId);
      if (!restaurant) {
        return res.status(404).json({ success: false, message: 'Nhà hàng không tồn tại.' });
      }
      if (restaurant.ownerId.toString() !== userId.toString()) {
        return res.status(403).json({ success: false, message: 'Bạn không phải chủ nhà hàng này.' });
      }

      const { plan } = req.body; // 'plus' hoặc 'pro'
      if (!plan || !SUBSCRIPTION_PLANS[plan]) {
        return res.status(400).json({ success: false, message: 'Gói dịch vụ không hợp lệ. Chọn plus hoặc pro.' });
      }

      const planInfo = SUBSCRIPTION_PLANS[plan];
      if (planInfo.price <= 0) {
        return res.status(400).json({ success: false, message: 'Gói Free không cần thanh toán.' });
      }

      // Kiểm tra subscription hiện tại - chặn downgrade
      const currentSub = await Subscription.findOne({
        restaurantId: targetId,
        status: 'active',
        expiredAt: { $gt: new Date() },
      });

      if (currentSub) {
        const planOrder = { free: 0, plus: 1, pro: 2 };
        if (planOrder[plan] <= planOrder[currentSub.plan]) {
          return res.status(400).json({
            success: false,
            message: `Không thể chọn gói ${plan}. Bạn đang sử dụng gói ${currentSub.plan}.`,
          });
        }

        // Tính tiền nâng cấp (pro-rata)
        const remainingDays = Math.max(0, Math.ceil((currentSub.expiredAt - new Date()) / (1000 * 60 * 60 * 24)));
        const currentPlanInfo = SUBSCRIPTION_PLANS[currentSub.plan];
        const dailyRate = currentPlanInfo.price / currentPlanInfo.durationDays;
        const creditAmount = Math.floor(dailyRate * remainingDays);
        amount = Math.max(planInfo.price - creditAmount, 1000); // Tối thiểu 1000 VNĐ
        description = `Nâng cấp gói ${currentSub.plan} → ${plan} (khấu trừ ${creditAmount.toLocaleString()}₫)`;
        metadata = { fromPlan: currentSub.plan, toPlan: plan, creditAmount, remainingDays };
      } else {
        amount = planInfo.price;
        description = `Mua gói ${planInfo.name} - 30 ngày`;
        metadata = { plan };
      }

      restaurantId = restaurant._id;

    } else {
      return res.status(400).json({ success: false, message: 'targetType phải là booking hoặc subscription.' });
    }

    // ─── Kiểm tra payment pending đã tồn tại ───
    const existingPending = await Payment.findOne({
      userId,
      targetType,
      targetId,
      status: 'pending',
    });

    if (existingPending && existingPending.checkoutUrl) {
      // Trả lại payment cũ nếu vẫn còn hợp lệ
      return res.status(200).json({
        success: true,
        message: 'Sử dụng link thanh toán đã tạo trước đó.',
        data: existingPending,
      });
    }

    // Hủy payment pending cũ nếu không có link
    if (existingPending) {
      existingPending.status = 'cancelled';
      existingPending.cancelledAt = new Date();
      await existingPending.save();
    }

    // ─── Tạo orderCode và Payment record ───
    const orderCode = await generateOrderCode();

    const payment = await Payment.create({
      userId,
      targetType,
      targetId,
      restaurantId,
      amount,
      orderCode,
      description,
      metadata,
      status: 'pending',
    });

    // ─── Gọi PayOS tạo link thanh toán ───
    try {
      const payosResponse = await payosService.createPaymentLink(
        orderCode,
        amount,
        description.substring(0, 25), // PayOS giới hạn 25 ký tự description
      );

      if (payosResponse && payosResponse.data) {
        payment.checkoutUrl = payosResponse.data.checkoutUrl;
        payment.paymentLinkId = payosResponse.data.paymentLinkId;
        payment.qrCode = payosResponse.data.qrCode || null;
        payment.expiredAt = new Date(Date.now() + 30 * 60 * 1000); // 30 phút
        await payment.save();
      }
    } catch (payosError) {
      console.error('❌ Lỗi tạo PayOS link:', payosError.message);
      payment.status = 'failed';
      await payment.save();
      return res.status(500).json({
        success: false,
        message: 'Không thể tạo link thanh toán PayOS. Vui lòng thử lại.',
        error: payosError.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Tạo link thanh toán thành công.',
      data: payment,
    });

  } catch (error) {
    console.error('❌ createPayment error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/payments/my ───
exports.getMyPayments = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, targetType } = req.query;
    const filter = { userId: req.user._id };
    if (status) filter.status = status;
    if (targetType) filter.targetType = targetType;

    const payments = await Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('restaurantId', 'name');

    const total = await Payment.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: payments,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/payments/:id ───
exports.getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('userId', 'fullName email phoneNumber')
      .populate('restaurantId', 'name');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment không tồn tại.' });
    }

    // Kiểm tra quyền: chỉ user tạo hoặc admin mới được xem
    if (payment.userId._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Không có quyền xem payment này.' });
    }

    return res.status(200).json({ success: true, data: payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/payments/check-status/:orderCode ───
exports.checkPaymentStatus = async (req, res) => {
  try {
    const { orderCode } = req.params;
    const payment = await Payment.findOne({ orderCode: parseInt(orderCode) });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment không tồn tại.' });
    }

    // Nếu đã paid thì trả về luôn
    if (payment.status === 'paid') {
      return res.status(200).json({ success: true, data: payment });
    }

    // Gọi PayOS kiểm tra trạng thái mới nhất
    try {
      const payosInfo = await payosService.getPaymentInfo(parseInt(orderCode));

      if (payosInfo?.data?.status === 'PAID' && payment.status === 'pending') {
        payment.status = 'paid';
        payment.paidAt = new Date();
        await payment.save();

        // Cập nhật entity liên quan
        await _processPaymentSuccess(payment);

        // Tạo transaction
        await Transaction.create({
          paymentId: payment._id,
          type: 'payment',
          amount: payment.amount,
          status: 'success',
          gateway: 'payos',
          gatewayTransactionId: payosInfo.data?.id || null,
        });
      } else if (payosInfo?.data?.status === 'CANCELLED') {
        payment.status = 'cancelled';
        payment.cancelledAt = new Date();
        await payment.save();
      }
    } catch (payosError) {
      console.error('❌ Lỗi check PayOS status:', payosError.message);
    }

    return res.status(200).json({ success: true, data: payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── POST /api/v1/payments/:id/cancel ───
exports.cancelPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment không tồn tại.' });
    }
    if (payment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Không có quyền hủy payment này.' });
    }
    if (payment.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể hủy payment đang pending.' });
    }

    try {
      await payosService.cancelPaymentLink(payment.orderCode);
    } catch (e) {
      console.error('PayOS cancel error:', e.message);
    }

    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    await payment.save();

    return res.status(200).json({ success: true, message: 'Đã hủy thanh toán.', data: payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Xử lý khi thanh toán thành công ───
async function _processPaymentSuccess(payment) {
  if (payment.targetType === 'booking') {
    const booking = await Booking.findById(payment.targetId).populate('voucherId');
    if (booking) {
      booking.depositPaid = true;
      booking.depositPaidAt = new Date();
      booking.paymentId = payment._id;
      booking.status = 'confirmed';
      booking.statusHistory.push({
        status: 'confirmed',
        changedAt: new Date(),
        note: 'Đã thanh toán đặt cọc qua PayOS',
      });
      await booking.save();

      // Redeem voucher khi thanh toán thành công
      if (booking.voucherId) {
        try {
          const voucherService = require('../services/voucher.service');
          await voucherService.redeemVoucher(
            booking.voucherId.code,
            booking.restaurantId,
            booking.customerId,
            booking.depositAmount, // Số tiền gốc trước giảm
            booking._id,
            payment._id
          );
          console.log(`✅ Voucher ${booking.voucherId.code} redeemed successfully for booking ${booking._id}`);
        } catch (voucherErr) {
          console.error(`❌ Lỗi redeem voucher khi thanh toán: ${voucherErr.message}`);
        }
      }
    }
    console.log(`✅ Booking ${payment.targetId} → confirmed (deposit paid)`);

  } else if (payment.targetType === 'subscription') {
    const plan = payment.metadata?.toPlan || payment.metadata?.plan;
    const planInfo = SUBSCRIPTION_PLANS[plan];
    if (!planInfo) return;

    const now = new Date();
    const expiredAt = new Date(now.getTime() + planInfo.durationDays * 24 * 60 * 60 * 1000);

    // Hết hạn subscription cũ nếu có
    await Subscription.updateMany(
      { restaurantId: payment.targetId, status: 'active' },
      { status: 'expired' }
    );

    // Tạo subscription mới
    await Subscription.create({
      ownerId: payment.userId,
      restaurantId: payment.targetId,
      plan,
      status: 'active',
      startedAt: now,
      expiredAt,
      paymentId: payment._id,
      benefitsSnapshot: planInfo.benefits,
    });

    console.log(`✅ Subscription ${plan} activated for restaurant ${payment.targetId}, expires ${expiredAt}`);
  }
}

// Export helper cho webhook
exports._processPaymentSuccess = _processPaymentSuccess;
