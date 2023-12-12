#!/bin/bash

echo Restoring backend python packages

pip3 install -r requirements-dev.txt

echo Restoring frontend npm packages
cd frontend
npm install

echo Building frontend

npm run build
cd ..

echo Starting backend
gunicorn --timeout=600 --worker-class=gevent --worker-connections=1000 --workers=3 --bind=127.0.0.1:8001 app:app
