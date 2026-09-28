// Theme Toggle Component

'use client';

import { useTheme } from './ThemeProvider';
import { Sun, Moon, Monitor } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
      {(['light', 'dark', 'system'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200 ${
            theme === t
              ? 'bg-white text-primary-600 shadow-sm dark:bg-gray-700 dark:text-primary-400'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
          aria-label={`Switch to ${t} mode`}
          aria-pressed={theme === t}
        >
          {t === 'light' && <Sun className="h-5 w-5" />}
          {t === 'dark' && <Moon className="h-5 w-5" />}
          {t === 'system' && <Monitor className="h-5 w-5" />}
        </button>
      ))}
    </div>
  );
}
