'use strict';

const GLOBAL_BOOKING_POLICIES = Object.freeze({
  booking: {
    topic: 'booking',
    sourceLabel: 'Chính sách đặt bàn chung của BookEat',
    answer: 'BookEat hỗ trợ khách gửi yêu cầu đặt bàn trực tuyến tại nhà hàng public trên hệ thống. Trạng thái và điều kiện cụ thể có thể khác nhau theo từng nhà hàng.',
    bullets: [
      'Khách cần đăng nhập trước khi tạo booking thật.',
      'Thông tin ngày, giờ, số khách và ghi chú chỉ được xác nhận trong luồng đặt bàn chính thức.',
      'Một số nhà hàng có thể yêu cầu đặt cọc hoặc ghi chú riêng, nếu nhà hàng công khai thông tin đó.',
    ],
  },
  cancellation: {
    topic: 'cancellation',
    sourceLabel: 'Chính sách hủy bàn chung của BookEat',
    answer: 'Việc hủy bàn cần thực hiện trong khu vực booking của khách hàng sau khi booking đã được tạo. Điều kiện hủy có thể phụ thuộc vào nhà hàng và trạng thái booking.',
    bullets: [
      'Phase AI public tools chỉ cung cấp thông tin tham khảo, không hủy booking thay khách.',
      'Nếu booking có đặt cọc, khách cần xem điều kiện hoàn tiền trong trang booking hoặc liên hệ nhà hàng.',
      'Nhà hàng có thể có quy định hủy riêng nếu đã công khai trong hồ sơ nhà hàng.',
    ],
  },
  deposit: {
    topic: 'deposit',
    sourceLabel: 'Chính sách đặt cọc chung của BookEat',
    answer: 'Một số nhà hàng có thể yêu cầu đặt cọc khi đặt bàn. BookEat chỉ hiển thị điều kiện đặt cọc khi nguồn dữ liệu public của nhà hàng hoặc luồng booking có cung cấp.',
    bullets: [
      'AI không tự xác nhận số tiền đặt cọc nếu không có nguồn public.',
      'Vui lòng kiểm tra bước đặt bàn chính thức trước khi thanh toán.',
    ],
  },
  general: {
    topic: 'general',
    sourceLabel: 'Chính sách công khai của BookEat',
    answer: 'BookEat chỉ sử dụng dữ liệu công khai hoặc policy đã được curate cho câu trả lời của trợ lý.',
    bullets: [
      'AI public tools chưa kiểm tra bàn trống, voucher, thanh toán hoặc xác nhận booking.',
      'Các thao tác booking thật vẫn cần thực hiện qua giao diện đặt bàn chính thức.',
    ],
  },
});

const getGlobalBookingPolicy = (topic = 'general') => (
  GLOBAL_BOOKING_POLICIES[topic] || GLOBAL_BOOKING_POLICIES.general || null
);

module.exports = {
  GLOBAL_BOOKING_POLICIES,
  getGlobalBookingPolicy,
};
