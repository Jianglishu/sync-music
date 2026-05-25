import React from 'react';

export default function DeviceList({ count = 0 }) {
  // Generate placeholder devices
  const devices = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `设备 ${i + 1}`,
  }));

  return (
    <div className="device-list">
      {devices.length === 0 ? (
        <div className="device-chip" style={{ color: '#555' }}>
          等待设备连接...
        </div>
      ) : (
        devices.map((d) => (
          <div key={d.id} className="device-chip">
            <span className="dot" />
            {d.name}
          </div>
        ))
      )}
    </div>
  );
}
