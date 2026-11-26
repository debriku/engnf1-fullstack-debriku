CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL, email VARCHAR(254) NOT NULL,
  passwordHash VARCHAR(100) NOT NULL, role ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER',
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY, externalId VARCHAR(100) NOT NULL, subject VARCHAR(150) NOT NULL, body TEXT NOT NULL,
  autoCategory ENUM('BILLING','BUG','FEATURE_REQUEST','LOGIN','DELIVERY') NOT NULL,
  category ENUM('BILLING','BUG','FEATURE_REQUEST','LOGIN','DELIVERY') NOT NULL,
  isHumanOverride TINYINT(1) NOT NULL DEFAULT 0,
  priority ENUM('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  assigneeId INT NULL, isReviewed TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tickets_ext (externalId),
  KEY ix_tickets_status_created (status, createdAt), KEY ix_tickets_category (category), KEY ix_tickets_priority (priority),
  KEY ix_tickets_created (createdAt, id),
  FOREIGN KEY (assigneeId) REFERENCES users(id)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ticket_events (
  id INT AUTO_INCREMENT PRIMARY KEY, ticketId INT NOT NULL, field ENUM('category','priority','status','assigneeId') NOT NULL,
  oldValue VARCHAR(100) NULL, newValue VARCHAR(100) NULL, actor VARCHAR(254) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_events_ticket (ticketId, id), FOREIGN KEY (ticketId) REFERENCES tickets(id)) CHARACTER SET utf8mb4;
CREATE TABLE IF NOT EXISTS resources (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60) NOT NULL, type ENUM('ROOM','LAB','EQUIPMENT') NOT NULL,
  capacity INT NOT NULL, description VARCHAR(300) NULL, isActive TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_resources_name (name)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY, resourceId INT NOT NULL, userId INT NOT NULL, ticketId INT NULL,
  startTime DATETIME(3) NOT NULL, endTime DATETIME(3) NOT NULL, purpose VARCHAR(200) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING', decisionNote VARCHAR(200) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_bookings_slot (resourceId, status, startTime, endTime), KEY ix_bookings_user (userId, status, startTime),
  FOREIGN KEY (resourceId) REFERENCES resources(id), FOREIGN KEY (userId) REFERENCES users(id),
  FOREIGN KEY (ticketId) REFERENCES tickets(id)) CHARACTER SET utf8mb4
