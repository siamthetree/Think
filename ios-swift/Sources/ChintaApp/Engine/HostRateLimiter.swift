import Foundation

public actor HostRateLimiter {
    private let maxConcurrentRequests: Int
    private let maxConcurrentPerHost: Int
    
    private var activeTotalCount: Int = 0
    private var activePerHostCount: [String: Int] = [:]
    private var waitQueue: [WaitingTask] = []
    
    private struct WaitingTask {
        let host: String
        let continuation: CheckedContinuation<Void, Never>
    }
    
    public init(maxConcurrent: Int = 4, maxPerHost: Int = 1) {
        self.maxConcurrentRequests = maxConcurrent
        self.maxConcurrentPerHost = maxPerHost
    }
    
    public func acquire(for url: URL) async {
        let host = url.host?.lowercased() ?? "unknown"
        
        if canExecute(host: host) {
            activeTotalCount += 1
            activePerHostCount[host, default: 0] += 1
            return
        }
        
        await withCheckedContinuation { continuation in
            waitQueue.append(WaitingTask(host: host, continuation: continuation))
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
        guard activeTotalCount < maxConcurrentRequests else { return }
        
        for index in waitQueue.indices {
            let task = waitQueue[index]
            let hostCurrent = activePerHostCount[task.host, default: 0]
            
            if hostCurrent < maxConcurrentPerHost {
                waitQueue.remove(at: index)
                activeTotalCount += 1
                activePerHostCount[task.host, default: 0] += 1
                task.continuation.resume()
                return
            }
        }
    }
}
