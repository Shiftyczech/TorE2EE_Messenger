function getReactNativeModule(): any {
  try {
    return require('react-native');
  } catch {
    return {};
  }
}

export interface IBatteryOptimizationService {
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<boolean>;
}

export class BatteryOptimizationService implements IBatteryOptimizationService {
  private getNativeModule(): any {
    const rn = getReactNativeModule();
    return rn?.NativeModules?.BatteryOptimization || null;
  }

  private getPlatform(): any {
    const rn = getReactNativeModule();
    return rn?.Platform || { OS: 'android' };
  }

  private getLinking(): any {
    const rn = getReactNativeModule();
    return rn?.Linking || null;
  }

  public async isIgnoringBatteryOptimizations(): Promise<boolean> {
    const Platform = this.getPlatform();
    if (Platform && Platform.OS && Platform.OS !== 'android') {
      return true;
    }

    const BatteryOptimization = this.getNativeModule();
    if (BatteryOptimization && typeof BatteryOptimization.isIgnoringBatteryOptimizations === 'function') {
      try {
        return await BatteryOptimization.isIgnoringBatteryOptimizations();
      } catch (err) {
        console.warn('Failed to check battery optimization status:', err);
        return false;
      }
    }
    return false;
  }

  public async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    const Platform = this.getPlatform();
    if (Platform && Platform.OS && Platform.OS !== 'android') {
      return true;
    }

    const BatteryOptimization = this.getNativeModule();
    if (BatteryOptimization && typeof BatteryOptimization.requestIgnoreBatteryOptimizations === 'function') {
      try {
        return await BatteryOptimization.requestIgnoreBatteryOptimizations();
      } catch (err) {
        console.warn('Failed to request ignore battery optimizations via native module:', err);
      }
    }

    // Fallback via Linking intent if native module is not directly accessible
    try {
      const Linking = this.getLinking();
      if (Linking && typeof Linking.sendIntent === 'function') {
        await Linking.sendIntent('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', [
          { key: 'package', value: 'package:com.tore2ee.messenger' },
        ]);
        return true;
      }
    } catch (fallbackErr) {
      console.warn('Fallback Linking intent failed:', fallbackErr);
    }

    return false;
  }

  public async openBatteryOptimizationSettings(): Promise<boolean> {
    const Platform = this.getPlatform();
    if (Platform && Platform.OS && Platform.OS !== 'android') {
      return true;
    }

    const BatteryOptimization = this.getNativeModule();
    if (BatteryOptimization && typeof BatteryOptimization.openBatteryOptimizationSettings === 'function') {
      try {
        return await BatteryOptimization.openBatteryOptimizationSettings();
      } catch (err) {
        console.warn('Failed to open battery optimization settings:', err);
      }
    }

    try {
      const Linking = this.getLinking();
      if (Linking && typeof Linking.sendIntent === 'function') {
        await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
        return true;
      }
    } catch {
      // Ignored
    }

    return false;
  }
}

export const BatteryOptimizationManager = new BatteryOptimizationService();

