import Foundation

public actor HostRateLimiter {
    private let maxConcurrentRequests: Int
    private let maxConcurrentPerHost: Int
    
    private var activeTotalCount: Int = 0
    private var activePerHostCount: [String: Int] = [:]
    private var waitQueue: [WaitingTask] = []
    
    private struct WaitingTask {
        let id: UUID
        let host: String
        let continuation: CheckedContinuation<Void, Error>
    }
    
    public init(maxConcurrent: Int = 4, maxPerHost: Int = 1) {
        self.maxConcurrentRequests = maxConcurrent
        self.maxConcurrentPerHost = maxPerHost
    }
    
    public func acquire(for url: URL) async throws {
        try Task.checkCancellation()
        let host = url.host?.lowercased() ?? "unknown"
        
        if canExecute(host: host) {
            activeTotalCount += 1
            activePerHostCount[host, default: 0] += 1
            return
        }
        
        let waiterID = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                waitQueue.append(WaitingTask(id: waiterID, host: host, continuation: continuation))
            }
        } onCancel: {
            Task {
                await self.cancelWaiter(id: waiterID)
            }
        }
    }
    
    private func cancelWaiter(id: UUID) {
        if let index = waitQueue.firstIndex(where: { $0.id == id }) {
            let waiter = waitQueue.remove(at: index)
            waiter.continuation.resume(throwing: CancellationError())
        }
    }
    
    public func release(for url: URL) {
        let host = url.host?.lowercased() ?? "unknown"
        
        activeTotalCount = max(0, activeTotalCount - 1)
        if let current = activePerHostCount[host], current > 1 {
            activePerHostCount[host] = current - 1
        } else {
            activePerHostCount.removeValue(forKey: host)
        }
        
        pumpQueue()
    }
    
    private func canExecute(host: String) -> Bool {
        guard activeTotalCount < maxConcurrentRequests else { return false }
        let currentForHost = activePerHostCount[host, default: 0]
        return currentForHost < maxConcurrentPerHost
    }
    
    private func pumpQueue() {
        while activeTotalCount < maxConcurrentRequests {
            guard let index = waitQueue.firstIndex(where: {
                activePerHostCount[$0.host, default: 0] < maxConcurrentPerHost
            }) else {
                return
            }
            
            let task = waitQueue.remove(at: index)
            activeTotalCount += 1
            activePerHostCount[task.host, default: 0] += 1
            task.continuation.resume(returning: ())
        }
    }
}
