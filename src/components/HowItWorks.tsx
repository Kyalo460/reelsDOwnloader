// How It Works Component

import { ArrowRight, MousePointerClick, Eye, Download, Check } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: MousePointerClick,
    title: 'Paste URL',
    description:
      'Copy any Instagram Reel link and paste it into the input field above. No account needed.',
  },
  {
    number: '02',
    icon: Eye,
    title: 'Preview & Verify',
    description:
      'We fetch the reel metadata and show you a preview with available download qualities.',
  },
  {
    number: '03',
    icon: Download,
    title: 'Download',
    description:
      'Choose your preferred quality (Original, HD, or SD) and start the secure download.',
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="bg-gray-50 py-20 dark:bg-gray-900/50 lg:py-32"
      aria-labelledby="how-it-works-heading"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <h2
            id="how-it-works-heading"
            className="mb-4 text-3xl font-bold text-gray-900 dark:text-white lg:text-4xl"
          >
            How It Works
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Three simple steps to download your favorite Reels.
          </p>
        </div>

        <div className="relative">
          {/* Connecting Line */}
          <div className="absolute bottom-20 left-1/2 top-20 hidden w-px -translate-x-1/2 bg-gray-200 dark:bg-gray-700 lg:block" />

          <div className="relative flex flex-col items-center gap-12 lg:flex-row">
            {steps.map((step, index) => (
              <div
                key={step.number}
                className="relative flex flex-1 flex-col items-center text-center"
                style={{ animationDelay: `${index * 200}ms` }}
              >
                {/* Step Circle */}
                <div className="relative z-10 flex flex-col items-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-lg font-bold text-white">
                    {step.number}
                  </div>
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/30">
                    <step.icon className="h-6 w-6 text-primary-600 dark:text-primary-400" />
                  </div>
                </div>

                {/* Step Content */}
                <div className="max-w-xs">
                  <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
                    {step.title}
                  </h3>
                  <p className="leading-relaxed text-gray-600 dark:text-gray-400">
                    {step.description}
                  </p>
                </div>

                {/* Arrow between steps */}
                {index < steps.length - 1 && (
                  <div className="absolute left-1/2 top-28 hidden h-px w-full bg-gray-200 dark:bg-gray-700 lg:block" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Mobile Step Indicators */}
        <div className="mt-12 flex items-center justify-center gap-2 lg:hidden">
          {steps.map((_, index) => (
            <button
              key={index}
              className="h-2 w-2 rounded-full bg-gray-300 transition-colors dark:bg-gray-600"
              aria-label={`Step ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
