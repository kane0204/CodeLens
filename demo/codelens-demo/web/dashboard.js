export function summarizeOrders(orders) {
  if (!orders.length) {
    return { count: 0, total: 0 };
  }
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  return { count: orders.length, total };
}

export const formatTotal = (value) => `$${value.toFixed(2)}`;

// TODO: share the pricing rules with the backend
export function previewPrice(price, vip) {
  if (vip) {
    return price * 0.9;
  }
  return price;
}
