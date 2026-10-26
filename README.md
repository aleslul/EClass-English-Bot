# EClass CLI Automation Tool

A Node.js command-line interface tool designed to interact with the GraphQL-based educational platform API. This utility inspects course unit structures, registers resource viewing progress, and processes practice evaluation items programmatically.

## Features

- **GraphQL Integration**: Communicates directly with the platform's API endpoints using Bearer token authentication and custom request headers.
- **Resource Management**: Automatically tracks and registers progress for static learning materials and articles.
- **Evaluation Handling**: Parses course items, submits initial validation probes, extracts hint structures, and completes practice exercises.
- **Selective Filtering**: Bypasses fully completed units and optional coursework to optimize execution time.

## Requirements

- Node.js (version 18 or higher recommended)
- Active session authorization token from the target platform

## Installation

1. Clone or download the repository.
2. Install dependencies:

```bash
npm install
```

## Configuration

Create a `.env` file in the root directory and configure the following environment variables:

```env
ECLASS_TOKEN=your_bearer_token_here
STUDENT_ID=your_student_id
COURSE_ID=your_course_id
PROGRAM_ID=2102
```

## Usage

To execute the script and begin processing course items, run:

```bash
npm start
```

## Project Structure

- `index.js`: Entry point that initializes configuration variables and invokes the main service workflow.
- `src/eclass.client.js`: Encapsulates HTTP client configurations, headers, timeouts, and query execution methods.
- `src/eclass.service.js`: Contains business logic for fetching course hierarchies, filtering pending tasks, and handling resource and evaluation submissions.