// Features Component

import { CheckCircle, Shield, Zap, Globe, Lock, Download } from 'lucide-react';

const features = [
  {
    icon: Zap,
    title: 'Fast Resolution',
    description: 'Optimized media resolution with intelligent caching for near-instant results.',
  },
  {
    icon: Shield,
    title: 'Privacy First',
    description:
      "No login required. We don't store your Instagram credentials or track your activity.",
  },
  {
    icon: Download,
    title: 'Multiple Qualities',
    description: 'Choose from Original, HD (720p+), or SD (480p) based on your needs.',
  },
  {
    icon: Globe,
    title: 'No Geographic Restrictions',
    description: 'Access publicly available content from anywhere in the world.',
  },
  {
    icon: Lock,
    title: 'Secure Downloads',
    description: 'Streamed downloads with size limits, timeout protection, and MIME validation.',
  },
  {
    icon: CheckCircle,
    title: 'Legal Compliance',
    description:
      'Only processes publicly accessible content. Respects private accounts and copyright.',
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 lg:py-32" aria-labelledby="features-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <h2
            id="features-heading"
            className="mb-4 text-3xl font-bold text-gray-900 dark:text-white lg:text-4xl"
          >
            Why Choose ReelDownloader?
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Built with modern technology for a fast, secure, and reliable experience.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <article
              key={feature.title}
              className="card-hover group p-6"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 transition-transform group-hover:scale-110 dark:bg-primary-900/30">
                <feature.icon className="h-6 w-6 text-primary-600 dark:text-primary-400" />
              </div>
              <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
                {feature.title}
              </h3>
              <p className="leading-relaxed text-gray-600 dark:text-gray-400">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
