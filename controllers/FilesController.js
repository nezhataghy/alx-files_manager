#!/usr/bin/node
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { ObjectID } from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

export default class FilesController {
  static async getUser(req) {
    const token = req.header('X-Token');
    if (!token) return null;

    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (!userId) return null;

    const user = await dbClient.client.db().collection('users')
      .findOne({ _id: ObjectID(userId) });

    if (user) return user;

    return null;
  }

  static async postUpload(req, res) {
    const user = await FilesController.getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const {
      name, type, parentId, isPublic, data,
    } = req.body;

    const acceptedTypes = ['folder', 'file', 'image'];

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !acceptedTypes.includes(type)) return res.status(400).json({ error: 'Missing type' });

    if (type !== 'folder' && !data) return res.status(400).json({ error: 'Missing data' });

    const files = dbClient.client.db().collection('files');

    if (parentId) {
      const idObject = new ObjectID(parentId);
      const file = await files.findOne({ _id: idObject });
      if (!file) return res.status(400).json({ error: 'Parent not found' });

      if (file.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }

    if (type === 'folder') {
      const newFolder = {
        userId: user._id,
        name,
        type,
        parentId: parentId || 0,
        isPublic: isPublic || false,
      };

      const result = await files.insertOne(newFolder);
      return res.status(201).json({
        id: result.insertedId,
        userId: user._id,
        name,
        type,
        parentId: parentId || 0,
        isPublic: isPublic || false,
      });
    }

    const filePath = process.env.FOLDER_PATH || '/tmp/files_manager';
    const fileName = `${filePath}/${uuidv4()}`;
    const buff = Buffer.from(data, 'base64');

    try {
      await fs.promises.writeFile(fileName, buff);
    } catch (error) {
      return res.status(500).json({ error: 'Cannot write file' });
    }

    const newFile = {
      userId: user._id,
      name,
      type,
      parentId: parentId || 0,
      isPublic: isPublic || false,
      localPath: fileName,
    };

    const result = await files.insertOne(newFile);
    return res.status(201).json({
      id: result.insertedId,
      userId: user._id,
      name,
      type,
      parentId: parentId || 0,
      isPublic: isPublic || false,
    });
  }

  static async getShow(req, res) {
    const user = await FilesController.getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    if (!fileId) return res.status(404).json({ error: 'Not found' });

    const idObject = new ObjectID(fileId);
    const file = await dbClient.client.db().collection('files').findOne({ _id: idObject });
    if (!file) return res.status(404).json({ error: 'Not found' });

    if (String(file.userId) !== String(user._id) && !file.isPublic) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
    });
  }

  static async getIndex(req, res) {
    const user = await FilesController.getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const parentId = req.query.parentId || 0;
    if (!parentId) return res.status(200).json([]);

    const idObject = new ObjectID(parentId);
    const files = await dbClient.client.db().collection('files').find({ parentId: idObject }).toArray();

    if (!files) return res.status(200).json([]);

    return res.status(200).json(files);
  }

  static async putPublish(req, res) {
    const user = await FilesController.getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    if (!fileId) return res.status(404).json({ error: 'Not found' });

    const idObject = new ObjectID(fileId);
    const file = await dbClient.client.db().collection('files').findOne({ _id: idObject });
    if (!file) return res.status(404).json({ error: 'Not found' });

    if (String(file.userId) !== String(user._id)) return res.status(403).json({ error: 'Forbidden' });

    await dbClient.client.db().collection('files').updateOne({ _id: idObject }, { $set: { isPublic: true } });

    return res.status(200).json({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: true,
    });
  }
}
