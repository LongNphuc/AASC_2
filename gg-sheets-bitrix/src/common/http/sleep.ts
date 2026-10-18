/** Chờ một khoảng thời gian (tách riêng để test thay bằng hàm giả). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
