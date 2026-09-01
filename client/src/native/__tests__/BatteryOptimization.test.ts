import { BatteryOptimizationService } from '../BatteryOptimization';

describe('BatteryOptimizationService', () => {
  it('handles battery optimization checks on non-android or mock environment gracefully', async () => {
    const service = new BatteryOptimizationService();
    const isIgnoring = await service.isIgnoringBatteryOptimizations();
    expect(typeof isIgnoring).toBe('boolean');
  });

  it('handles requestIgnoreBatteryOptimizations gracefully', async () => {
    const service = new BatteryOptimizationService();
    const result = await service.requestIgnoreBatteryOptimizations();
    expect(typeof result).toBe('boolean');
  });

  it('handles openBatteryOptimizationSettings gracefully', async () => {
    const service = new BatteryOptimizationService();
    const result = await service.openBatteryOptimizationSettings();
    expect(typeof result).toBe('boolean');
  });
});

