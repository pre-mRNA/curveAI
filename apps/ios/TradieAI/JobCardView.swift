import SwiftUI

struct JobBoardView: View {
    @ObservedObject var store: OnboardingFlowStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let selectedJob = store.selectedJob {
                JobDetailCard(job: selectedJob)
            } else {
                SurfaceCard(title: "No jobs loaded", subtitle: "Refresh once the session is ready.") {
                    Text("A backend job feed will appear here after consent and authentication.")
                        .foregroundStyle(.secondary)
                }
            }

            SurfaceCard(title: "Live queue", subtitle: "\(store.jobs.count) jobs ready for the tradie app") {
                VStack(spacing: 12) {
                    ForEach(store.jobs) { job in
                        Button {
                            store.selectJob(job)
                        } label: {
                            JobQueueRow(job: job, isSelected: job.id == store.selectedJob?.id)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct JobQueueRow: View {
    let job: TradieJob
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(LinearGradient(colors: [.indigo, .cyan], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 42, height: 42)
                .overlay(
                    Text(job.customerInitials)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(job.customerName)
                    .font(.headline)
                Text(job.addressLine)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(job.proposedQuote)
                    .font(.headline)
                Text(job.locationSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(isSelected ? Color.indigo.opacity(0.12) : Color.black.opacity(0.03))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(isSelected ? Color.indigo.opacity(0.22) : Color.clear)
        )
    }
}

struct JobDetailCard: View {
    let job: TradieJob

    var body: some View {
        SurfaceCard(title: job.customerName, subtitle: job.phoneNumber) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    Circle()
                        .fill(LinearGradient(colors: [.indigo, .teal], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 56, height: 56)
                        .overlay(
                            Text(job.customerInitials)
                                .font(.headline.bold())
                                .foregroundStyle(.white)
                        )

                    VStack(alignment: .leading, spacing: 6) {
                        Text(job.addressLine)
                            .font(.headline)
                        Text(job.suburb)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }

                VStack(spacing: 12) {
                    HStack(spacing: 12) {
                        MetricPill(label: "Quote", value: job.proposedQuote)
                        MetricPill(label: "Confidence", value: job.quoteConfidence)
                    }

                    HStack(spacing: 12) {
                        MetricPill(label: "Photos", value: "\(job.photos.count)")
                        MetricPill(label: "Location", value: job.locationSummary)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Job notes")
                        .font(.subheadline.weight(.semibold))
                    Text(job.notes)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Photos")
                        .font(.subheadline.weight(.semibold))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 12)], spacing: 12) {
                        ForEach(job.photos) { photo in
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(photo.fillColor.opacity(0.18))
                                .frame(height: 88)
                                .overlay(
                                    VStack(spacing: 6) {
                                        Image(systemName: "photo")
                                            .font(.title2)
                                            .foregroundStyle(photo.fillColor)
                                        Text(photo.caption)
                                            .font(.caption2)
                                            .multilineTextAlignment(.center)
                                            .foregroundStyle(.secondary)
                                    }
                                    .padding(8)
                                )
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Suggested next step")
                        .font(.subheadline.weight(.semibold))
                    Text(job.nextAction)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 12) {
                    Button("Send photo link") { }
                        .buttonStyle(.borderedProminent)
                    Button("Open call log") { }
                        .buttonStyle(.bordered)
                }
            }
        }
    }
}

private extension TradiePhoto {
    var fillColor: Color {
        switch tint {
        case "cyan":
            return .cyan
        case "teal":
            return .teal
        case "orange":
            return .orange
        case "pink":
            return .pink
        default:
            return .indigo
        }
    }
}

#Preview {
    ScrollView {
        JobBoardView(store: OnboardingFlowStore(client: MockTradieAPIClient()))
            .padding()
    }
}
