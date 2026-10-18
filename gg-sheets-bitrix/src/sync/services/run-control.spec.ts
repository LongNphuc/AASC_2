import { RunControlState } from './run-control';

describe('RunControlState', () => {
  it('quá thời gian tối đa thì báo dừng (60003); chờ thêm có vượt giờ không', () => {
    let now = 1000;
    const control = new RunControlState(5000, jest.fn(), () => now);
    expect(control.stopReason()).toBeNull();
    expect(control.canWait(3000)).toBe(true);
    expect(control.canWait(4500)).toBe(false);
    now = 5000;
    expect(control.stopReason()?.errorKbn).toBe(60003);
  });

  it('mất khóa thì báo dừng (60004); cooldown chuyển cho hàm ghi', async () => {
    const cooldown = jest.fn().mockResolvedValue(undefined);
    const control = new RunControlState(Infinity, cooldown);
    control.lockLost = true;
    expect(control.stopReason()?.errorKbn).toBe(60004);
    const at = new Date();
    await control.onCooldown(at);
    expect(cooldown).toHaveBeenCalledWith(at);
  });
});
